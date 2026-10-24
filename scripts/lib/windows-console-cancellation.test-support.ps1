# Test-only private console. Never attach to an existing console or process.
param([Parameter(Mandatory=$true)][string]$Configuration, [switch]$Driver)
$ErrorActionPreference = 'Stop'
$config = Get-Content -LiteralPath $Configuration -Raw | ConvertFrom-Json
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
public static class DpfConsoleFixture {
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
    struct Startup {
        public uint cb; public string reserved, desktop, title;
        public uint x,y,width,height,charsX,charsY,fill,flags;
        public short show,reserved2; public IntPtr reservedPtr,input,output,error;
    }
    [StructLayout(LayoutKind.Sequential)]
    struct ProcessInfo { public IntPtr process,thread; public uint pid,tid; }
    [StructLayout(LayoutKind.Sequential)]
    struct BasicProcess { public IntPtr reserved1,peb,reserved2,reserved3,pid,parent; }
    [StructLayout(LayoutKind.Sequential)]
    struct Limits {
        public long processTime,jobTime; public uint flags;
        public UIntPtr minimum,maximum; public uint active; public UIntPtr affinity;
        public uint priority,scheduling;
        public ulong reads,writes,other,readBytes,writeBytes,otherBytes;
        public UIntPtr processMemory,jobMemory,peakProcessMemory,peakJobMemory;
    }
    [StructLayout(LayoutKind.Sequential)]
    struct Coord { public short x,y; public Coord(short xValue,short yValue) { x=xValue;y=yValue; } }
    [StructLayout(LayoutKind.Sequential)]
    struct Rect { public short left,top,right,bottom; }
    [StructLayout(LayoutKind.Sequential)]
    struct BufferInfo { public Coord size,cursor; public short attributes; public Rect window; public Coord maximum; }
    [StructLayout(LayoutKind.Explicit, Size=20)]
    struct InputRecord {
        [FieldOffset(0)] public short type;
        [FieldOffset(4)] public int down;
        [FieldOffset(8)] public short repeats;
        [FieldOffset(10)] public short key;
        [FieldOffset(12)] public short scan;
        [FieldOffset(14)] public char character;
        [FieldOffset(16)] public uint control;
    }
    delegate bool Handler(uint kind);
    static Handler handler;
    static int controls;
    public sealed class OwnedProcess {
        public readonly int Id; public readonly IntPtr Handle;
        public readonly DateTime StartTime;
        public OwnedProcess(int id,IntPtr handle) {
            Id=id; Handle=handle;
            long created,exited,kernel,user; Check(GetProcessTimes(handle,out created,out exited,out kernel,out user));
            StartTime=DateTime.FromFileTimeUtc(created);
        }
        public bool HasExited { get { return WaitForExit(0); } }
        public int ExitCode { get { uint code; Check(GetExitCodeProcess(Handle,out code)); return unchecked((int)code); } }
        public bool WaitForExit(int milliseconds) {
            uint result=WaitForSingleObject(Handle,(uint)milliseconds);
            if(result==0xffffffff) Check(false);
            return result==0;
        }
    }
    static readonly Dictionary<int,OwnedProcess> owned = new Dictionary<int,OwnedProcess>();
    static IntPtr job = IntPtr.Zero;
    static IntPtr output = IntPtr.Zero;
    static IntPtr input = IntPtr.Zero;
    public static int ControlCount { get { return Volatile.Read(ref controls); } }
    public static int RootPid { get { return Process.GetCurrentProcess().Id; } }
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    static extern bool CreateProcessW(string application,StringBuilder command,IntPtr processAttributes,IntPtr threadAttributes,bool inherit,uint flags,IntPtr environment,string directory,ref Startup startup,out ProcessInfo info);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll", SetLastError=true)] static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool TerminateProcess(IntPtr process,uint code);
    [DllImport("kernel32.dll", SetLastError=true)] static extern uint WaitForSingleObject(IntPtr handle,uint milliseconds);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetProcessTimes(IntPtr handle,out long created,out long exited,out long kernel,out long user);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetExitCodeProcess(IntPtr handle,out uint code);
    [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr OpenProcess(uint access,bool inherit,int pid);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool TerminateJobObject(IntPtr handle,uint code);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr attributes,string name);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetInformationJobObject(IntPtr handle,int kind,ref Limits limits,uint size);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr jobHandle,IntPtr process);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool QueryInformationJobObject(IntPtr handle,int kind,IntPtr info,uint size,out uint returned);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetConsoleCtrlHandler(Handler callback,bool add);
    [DllImport("kernel32.dll", SetLastError=true)] static extern uint GetConsoleProcessList(uint[] processes,uint count);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool GenerateConsoleCtrlEvent(uint kind,uint group);
    [DllImport("ntdll.dll")] static extern int NtQueryInformationProcess(IntPtr process,int kind,ref BasicProcess info,int size,out int returned);
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr CreateFile(string path,uint access,uint share,IntPtr security,uint creation,uint flags,IntPtr template);
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetConsoleScreenBufferInfo(IntPtr handle,out BufferInfo info);
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool ReadConsoleOutputCharacterW(IntPtr handle,[Out] char[] text,uint count,Coord position,out uint read);
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool WriteConsoleInputW(IntPtr handle,InputRecord[] records,uint count,out uint written);
    static void Check(bool ok) { if(!ok) throw new Win32Exception(Marshal.GetLastWin32Error()); }
    public static string Quote(string value) {
        if(String.IsNullOrEmpty(value) || value.IndexOfAny(new char[]{'"','%','!','^','&','|','<','>','\r','\n'})>=0)
            throw new ArgumentException("Unsupported command metacharacter in owned fixture argument");
        return "\""+value+"\"";
    }
    public static OwnedProcess Launch(string application,string arguments,string directory,bool newConsole) {
        var startup = new Startup(); startup.cb=(uint)Marshal.SizeOf(startup);
        startup.flags=1; startup.show=0; // STARTF_USESHOWWINDOW, SW_HIDE; genuine console handles.
        ProcessInfo info;
        uint flags=0x400|0x4; // UNICODE_ENVIRONMENT, SUSPENDED until its authoritative handle is retained.
        if(newConsole) flags|=0x10;
        Check(CreateProcessW(application,new StringBuilder(Quote(application)+" "+arguments),IntPtr.Zero,IntPtr.Zero,false,flags,IntPtr.Zero,directory,ref startup,out info));
        try {
            if(newConsole) {
                job=CreateJobObject(IntPtr.Zero,null); Check(job!=IntPtr.Zero);
                var limits=new Limits(); limits.flags=0x2000;
                Check(SetInformationJobObject(job,9,ref limits,(uint)Marshal.SizeOf(limits)));
                Check(AssignProcessToJobObject(job,info.process));
            }
            var process=new OwnedProcess((int)info.pid,info.process);
            owned[process.Id]=process;
            Check(ResumeThread(info.thread)!=0xffffffff);
            info.process=IntPtr.Zero; // Ownership transferred; never reopen this PID.
            return process;
        } catch { owned.Remove((int)info.pid); TerminateProcess(info.process,99); WaitForSingleObject(info.process,5000); throw; }
        finally { CloseHandle(info.thread); if(info.process!=IntPtr.Zero) CloseHandle(info.process); }
    }
    public static void InitializeDriver() {
        // A real handler is process-local. NULL/TRUE would immunize children.
        handler=kind=>{ if(kind==0) { Interlocked.Increment(ref controls); return true; } return false; };
        Check(SetConsoleCtrlHandler(handler,true));
        output=CreateFile("CONOUT$",0xc0000000,3,IntPtr.Zero,3,0,IntPtr.Zero);
        input=CreateFile("CONIN$",0xc0000000,3,IntPtr.Zero,3,0,IntPtr.Zero);
        Check(output!=new IntPtr(-1) && input!=new IntPtr(-1));
    }
    public static uint[] Members() {
        uint capacity=16;
        for(int attempt=0;attempt<4;attempt++) {
            var ids=new uint[capacity]; uint count=GetConsoleProcessList(ids,capacity);
            Check(count!=0);
            if(count>128) throw new InvalidOperationException("Console membership exceeds fixture bound");
            if(count>capacity) { capacity=count;continue; }
            Array.Resize(ref ids,(int)count); return ids;
        }
        throw new InvalidOperationException("Unstable console membership");
    }
    static OwnedProcess RetainOwned(int pid,HashSet<int> path) {
        OwnedProcess retained;
        if(owned.TryGetValue(pid,out retained)) {
            if(retained.HasExited) throw new InvalidOperationException("Exited console identity");
            return retained;
        }
        if(path.Count>=64 || !path.Add(pid)) throw new InvalidOperationException("Invalid console ancestry");
        var handle=OpenProcess(0x100001|0x1000,false,pid); Check(handle!=IntPtr.Zero);
        try {
            var process=new OwnedProcess(pid,handle);
            var info=new BasicProcess(); int returned;
            if(NtQueryInformationProcess(process.Handle,0,ref info,Marshal.SizeOf(info),out returned)!=0)
                throw new InvalidOperationException("Console parent identity unavailable");
            int parent=info.parent.ToInt32();
            var ownerBirth=parent==RootPid ? Process.GetCurrentProcess().StartTime.ToUniversalTime() : RetainOwned(parent,path).StartTime;
            if(ownerBirth>process.StartTime)
                throw new InvalidOperationException("Impossible console ancestry");
            owned[pid]=process; return process;
        } catch { CloseHandle(handle); throw; }
    }
    public static string[] ValidateMembers() {
        var result=new List<string>();
        foreach(uint id in Members()) {
            var birth=id==RootPid ? Process.GetCurrentProcess().StartTime.ToUniversalTime() : RetainOwned((int)id,new HashSet<int>()).StartTime;
            result.Add(id+":"+birth.Ticks);
        }
        return result.ToArray();
    }
    public static void SendCtrlC() { ValidateMembers(); Check(GenerateConsoleCtrlEvent(0,0)); }
    public static string ReadScreen() {
        BufferInfo info; Check(GetConsoleScreenBufferInfo(output,out info));
        int rows=Math.Min(100,(int)info.size.y); int start=Math.Max(0,info.cursor.y-rows+1);
        uint count=(uint)Math.Min(16384,(info.cursor.y-start+1)*info.size.x);
        var text=new char[count]; uint read;
        Check(ReadConsoleOutputCharacterW(output,text,count,new Coord(0,(short)start),out read));
        return new String(text,0,(int)read);
    }
    public static void ConfirmBatch() {
        var records=new InputRecord[4];
        for(int i=0;i<4;i++) { records[i].type=1;records[i].down=i%2==0?1:0;records[i].repeats=1;
            records[i].key=(short)(i<2?0x59:0x0d);records[i].character=i<2?'Y':'\r'; }
        uint written; Check(WriteConsoleInputW(input,records,4,out written));
        if(written!=4) throw new InvalidOperationException("Incomplete owned batch input");
    }
    public static string[] LiveRetained() {
        var result=new List<string>();
        foreach(var pair in owned) if(!pair.Value.HasExited) result.Add(pair.Key+":"+pair.Value.StartTime.ToUniversalTime().Ticks);
        return result.ToArray();
    }
    public static bool CleanupOwned() {
        bool emergency=false;
        try { foreach(var pair in owned) {
            if(pair.Value.HasExited) continue;
            emergency=true; Check(TerminateProcess(pair.Value.Handle,99));
            if(!pair.Value.WaitForExit(5000)) throw new InvalidOperationException("Owned process closure unproven");
        } } finally { try { if(job!=IntPtr.Zero) {
            // The enclosing harness Job contains every driver descendant,
            // including processes whose console/stdio differs from cmd.exe.
            var info=Marshal.AllocHGlobal(48);
            try {
                uint returned;
                Check(QueryInformationJobObject(job,1,info,48,out returned));
                if(Marshal.ReadInt32(info,40)>0) {
                    emergency=true; Check(TerminateJobObject(job,99));
                    var deadline=DateTime.UtcNow.AddSeconds(5);
                    do {
                        Check(QueryInformationJobObject(job,1,info,48,out returned));
                        if(Marshal.ReadInt32(info,40)==0) break;
                        Thread.Sleep(25);
                    } while(DateTime.UtcNow<deadline);
                    if(Marshal.ReadInt32(info,40)!=0) throw new InvalidOperationException("Owned Job closure unproven");
                }
            } finally { Marshal.FreeHGlobal(info); Check(CloseHandle(job));job=IntPtr.Zero; }
        } } finally {
            foreach(var pair in owned) Check(CloseHandle(pair.Value.Handle));
            owned.Clear();
        } }
        return emergency;
    }
}
'@

function Write-FixtureJson([string]$Name, $Value) {
    $path = Join-Path $config.evidenceDirectory $Name
    [IO.File]::WriteAllText($path, ($Value | ConvertTo-Json -Depth 10), [Text.UTF8Encoding]::new($false))
}

if (-not $Driver) {
    $process = $null
    $failure = $null
    try {
        $arguments = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File ' + [DpfConsoleFixture]::Quote($PSCommandPath) + ' -Configuration ' + [DpfConsoleFixture]::Quote($Configuration) + ' -Driver'
        $process = [DpfConsoleFixture]::Launch((Join-Path $PSHOME 'powershell.exe'), $arguments, $config.worktree, $true)
        Write-FixtureJson 'launcher.json' @{ driverPid=$process.Id; driverBirth=$process.StartTime.ToUniversalTime().Ticks }
        $deadline = [DateTime]::UtcNow.AddSeconds(35)
        while (-not $process.WaitForExit(100)) {
            if (Test-Path -LiteralPath (Join-Path $config.evidenceDirectory 'abort.request')) { throw 'Parent requested fixture emergency cleanup' }
            if ([DateTime]::UtcNow -ge $deadline) { throw 'Private console driver exceeded 35 seconds' }
        }
        if ($process.ExitCode -ne 0) { throw ('Private console driver exit ' + $process.ExitCode) }
    } catch { $failure = $_.Exception.Message }
    finally {
        $emergency = [DpfConsoleFixture]::CleanupOwned()
        Write-FixtureJson 'launcher-result.json' @{ failure=$failure; emergencyCleanup=$emergency }
    }
    if ($failure) { Write-Error $failure }
    exit 0
}

$failure = $null
$target = $null
$sent = $false
$confirmed = $false
$before = @()
$live = @()
$screen = ''
try {
    [DpfConsoleFixture]::InitializeDriver()
    $initial = [DpfConsoleFixture]::Members()
    if ($initial.Count -ne 1 -or $initial[0] -ne $PID) { throw 'Driver console was not created exclusively for this fixture' }
    $quoted = @($config.arguments | ForEach-Object { [DpfConsoleFixture]::Quote([string]$_) })
    $command = '/d /s /c "' + [DpfConsoleFixture]::Quote($config.pnpm) + ' ' + ($quoted -join ' ') + '"'
    $target = [DpfConsoleFixture]::Launch($env:ComSpec, $command, $config.worktree, $false)
    Write-FixtureJson 'driver-ready.json' @{ driverPid=$PID; targetPid=$target.Id; targetBirth=$target.StartTime.ToUniversalTime().Ticks }
    $deadline = [DateTime]::UtcNow.AddSeconds(30)
    while (-not $target.HasExited) {
        if ([DateTime]::UtcNow -ge $deadline) { throw 'Private console target exceeded 30 seconds' }
        $screen = [DpfConsoleFixture]::ReadScreen()
        if (-not $sent -and (Test-Path -LiteralPath (Join-Path $config.evidenceDirectory 'cancel.request'))) {
            $before = [DpfConsoleFixture]::ValidateMembers()
            [DpfConsoleFixture]::SendCtrlC()
            $sent = $true
            Write-FixtureJson 'control-sent.json' @{ members=$before; at=[DateTime]::UtcNow.ToString('o') }
        }
        if ($sent -and -not $confirmed -and $screen -match 'Terminate batch job\s*\(Y/N\)\?') {
            [DpfConsoleFixture]::ConfirmBatch()
            $confirmed = $true
        }
        Start-Sleep -Milliseconds 50
    }
    $screen = [DpfConsoleFixture]::ReadScreen()
    # This observes closure before the launcher's enclosing Job is closed.
    $closureDeadline = [DateTime]::UtcNow.AddSeconds(2)
    do {
        $live = [DpfConsoleFixture]::LiveRetained()
        if ($live.Count -eq 0) { break }
        Start-Sleep -Milliseconds 50
    } while ([DateTime]::UtcNow -lt $closureDeadline)
} catch { $failure = $_.Exception.Message }
finally {
    $exitCode = if ($target -and $target.HasExited) { $target.ExitCode } else { $null }
    Write-FixtureJson 'driver-result.json' @{ failure=$failure; exitCode=$exitCode; sent=$sent; controlWitnessCount=[DpfConsoleFixture]::ControlCount; batchConfirmed=$confirmed; members=$before; liveBeforeHarnessCleanup=$live; screen=$screen }
    $emergency = [DpfConsoleFixture]::CleanupOwned()
    Write-FixtureJson 'driver-cleanup.json' @{ emergencyCleanup=$emergency }
}
if ($failure) { exit 1 }
exit 0
