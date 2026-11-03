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
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool IsProcessInJob(IntPtr process,IntPtr jobHandle,out bool member);
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
    public static void CreateOwnedJob() {
        if(job!=IntPtr.Zero) throw new InvalidOperationException("Owned Job already created");
        job=CreateJobObject(IntPtr.Zero,null); Check(job!=IntPtr.Zero);
        var limits=new Limits(); limits.flags=0x2000;
        Check(SetInformationJobObject(job,9,ref limits,(uint)Marshal.SizeOf(limits)));
    }
    public static OwnedProcess Launch(string application,string arguments,string directory,bool newConsole,bool noConsole=false) {
        var startup = new Startup(); startup.cb=(uint)Marshal.SizeOf(startup);
        startup.flags=1; startup.show=0; // STARTF_USESHOWWINDOW, SW_HIDE; genuine console handles.
        ProcessInfo info;
        uint flags=0x400|0x4; // UNICODE_ENVIRONMENT, SUSPENDED until its authoritative handle is retained.
        if(newConsole) flags|=0x10;
        if(noConsole) flags|=0x08000000; // CREATE_NO_WINDOW, test-only non-console descendant.
        Check(CreateProcessW(application,new StringBuilder(Quote(application)+" "+arguments),IntPtr.Zero,IntPtr.Zero,false,flags,IntPtr.Zero,directory,ref startup,out info));
        try {
            if(newConsole) {
                CreateOwnedJob();
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
        // PowerShell inherits ignore-CTRL+C. Adding a handler does not clear
        // that attribute, so GenerateConsoleCtrlEvent returns success and no
        // process on the console runs a handler. Children copy it at
        // CreateProcess. Clear it before the witness is installed and before
        // the target starts. NULL/TRUE would immunize children again.
        Check(SetConsoleCtrlHandler(null,false));
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
    public static string LaunchJobProbe(string application,string arguments,string directory) {
        // The enclosing launcher Job remains the owner; the driver deliberately
        // does not retain this non-console child in its console-only inventory.
        var process=Launch(application,arguments,directory,false,true);
        string identity=process.Id+":"+process.StartTime.ToUniversalTime().Ticks;
        owned.Remove(process.Id); Check(CloseHandle(process.Handle));
        return identity;
    }
    public sealed class JobSnapshot {
        public int? activeCount;
        public string[] members=new string[0];
        public string failure, failureOperation, failureIdentity;
        public int? failureNativeError, failurePid;
        public string cleanupFailure, probeExitedIdentity;
        public int? cleanupNativeError;
    }
    static void RecordObservationFailure(JobSnapshot snapshot,Exception error,string operation,int? pid,string identity) {
        if(snapshot.failure!=null) return; // Cleanup must never replace the primary failure.
        snapshot.failure=error.Message; snapshot.failureOperation=operation;
        var native=error as Win32Exception;
        snapshot.failureNativeError=native==null ? (int?)null : native.NativeErrorCode;
        snapshot.failurePid=pid; snapshot.failureIdentity=identity;
    }
    static void CloseObservationHandle(JobSnapshot snapshot,IntPtr handle,int pid,string identity,bool injectFailure) {
        bool closed=CloseHandle(handle);
        // The real observation handle is closed first; the fault uses no owned resource.
        if(closed && injectFailure) closed=CloseHandle(IntPtr.Zero);
        if(closed) return;
        var error=new Win32Exception(Marshal.GetLastWin32Error());
        snapshot.cleanupFailure=error.Message; snapshot.cleanupNativeError=error.NativeErrorCode;
        RecordObservationFailure(snapshot,error,"CloseHandle",pid,identity);
    }
    static int ActiveJobCount() {
        if(job==IntPtr.Zero) throw new InvalidOperationException("Owned Job handle unavailable");
        var info=Marshal.AllocHGlobal(48);
        try {
            uint returned; Check(QueryInformationJobObject(job,1,info,48,out returned));
            return Marshal.ReadInt32(info,40);
        } finally { Marshal.FreeHGlobal(info); }
    }
    public static JobSnapshot ObserveJob(string fault,int exitPid,string exitRequest) {
        var observation=new JobSnapshot();
        string operation="owned-job-handle", identity=null; int? memberPid=null;
        // Query the owned kernel Job only; PID values never grant kill authority.
        const int capacity=128; int size=8+IntPtr.Size*capacity;
        var info=Marshal.AllocHGlobal(size);
        try {
            if(job==IntPtr.Zero || fault=="missing-job") throw new InvalidOperationException("Owned Job handle unavailable");
            uint returned;
            operation="QueryInformationJobObject(membership)";
            Check(QueryInformationJobObject(fault=="query-failure" ? new IntPtr(-1) : job,3,info,(uint)size,out returned));
            operation="membership-count-bounds";
            int assigned=Marshal.ReadInt32(info,0), count=Marshal.ReadInt32(info,4);
            if(count<0 || count>capacity || assigned!=count)
                throw new InvalidOperationException("Owned Job membership exceeds observation bound");
            operation="QueryInformationJobObject(accounting)";
            observation.activeCount=ActiveJobCount();
            if(fault=="exited-member") {
                // Deterministically retire an owned member AFTER its PID was enumerated.
                operation="probe-member-in-snapshot"; memberPid=exitPid;
                bool listed=false;
                for(int i=0;i<count;i++) if(Marshal.ReadIntPtr(info,8+i*IntPtr.Size).ToInt64()==exitPid) listed=true;
                if(!listed || exitPid<=0) throw new InvalidOperationException("Exit probe member absent from owned snapshot");
                operation="OpenProcess(probe)";
                var retained=OpenProcess(0x100000|0x1000,false,exitPid); Check(retained!=IntPtr.Zero);
                try {
                    operation="GetProcessTimes(probe)";
                    var exiting=new OwnedProcess(exitPid,retained);
                    identity=exitPid+":"+exiting.StartTime.ToUniversalTime().Ticks;
                    operation="IsProcessInJob(probe)";
                    bool member; Check(IsProcessInJob(retained,job,out member));
                    if(!member) throw new InvalidOperationException("Exit probe is not an owned Job member");
                    operation="request-probe-exit";
                    System.IO.File.WriteAllText(exitRequest,"exit after owned membership snapshot");
                    operation="WaitForSingleObject(probe)";
                    if(!exiting.WaitForExit(3000)) throw new InvalidOperationException("Exit probe did not terminate within its bound");
                    observation.probeExitedIdentity=identity;
                } catch(Exception error) { RecordObservationFailure(observation,error,operation,memberPid,identity); }
                finally { CloseObservationHandle(observation,retained,exitPid,identity,false); }
                if(observation.failure!=null) return observation;
            }
            var identities=new List<string>();
            for(int index=0;index<count;index++) {
                operation="member-pid-bounds"; memberPid=null; identity=null;
                int pid=checked((int)Marshal.ReadIntPtr(info,8+index*IntPtr.Size).ToInt64());
                memberPid=pid; operation="OpenProcess";
                var handle=OpenProcess(0x100000|0x1000,false,pid); Check(handle!=IntPtr.Zero);
                try {
                    // Use a deliberately invalid observation handle in the failure
                    // probe. Containment always retains the real owned Job handle.
                    operation="GetProcessTimes";
                    var process=new OwnedProcess(pid,(fault=="identity-failure" || fault=="identity-cleanup-failure") ? IntPtr.Zero : handle);
                    identity=pid+":"+process.StartTime.ToUniversalTime().Ticks;
                    operation="IsProcessInJob";
                    bool member; Check(IsProcessInJob(handle,job,out member));
                    operation="owned-job-membership";
                    if(!member) throw new InvalidOperationException("Observed process left owned Job before identity validation");
                    identities.Add(identity);
                    observation.members=identities.ToArray();
                } catch(Exception error) { RecordObservationFailure(observation,error,operation,memberPid,identity); }
                finally { CloseObservationHandle(observation,handle,pid,identity,fault=="identity-cleanup-failure"); }
                if(observation.failure!=null) break;
            }
        } catch(Exception error) { RecordObservationFailure(observation,error,operation,memberPid,identity); }
        finally { Marshal.FreeHGlobal(info); }
        return observation;
    }
    public static void ReleaseRetained() {
        // Observation handles do not own descendant lifetime. Only the launcher
        // owns containment and may terminate its Job after bounded settlement.
        var errors=new List<Exception>();
        foreach(var pair in owned) {
            try { Check(CloseHandle(pair.Value.Handle)); } catch(Exception error) { errors.Add(error); }
        }
        owned.Clear();
        if(errors.Count>0) throw new AggregateException("Retained handle release failed",errors);
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
            try {
                if(ActiveJobCount()>0) {
                    emergency=true; Check(TerminateJobObject(job,99));
                    var elapsed=Stopwatch.StartNew();
                    while(ActiveJobCount()>0 && elapsed.ElapsedMilliseconds<5000) Thread.Sleep(25);
                    if(ActiveJobCount()!=0) throw new InvalidOperationException("Owned Job closure unproven");
                }
            } finally { Check(CloseHandle(job));job=IntPtr.Zero; }
        } } finally {
            ReleaseRetained();
        } }
        return emergency;
    }
}
'@

function Write-FixtureJson([string]$Name, $Value) {
    $path = Join-Path $config.evidenceDirectory $Name
    [IO.File]::WriteAllText($path, ($Value | ConvertTo-Json -Depth 10), [Text.UTF8Encoding]::new($false))
}

function Wait-OwnedJobClosure([string]$Fault) {
    $budgetMs = 10000
    $elapsed = [Diagnostics.Stopwatch]::StartNew()
    $snapshots = [Collections.Generic.List[object]]::new()
    $result = @{ outcome='timed-out'; budgetMs=$budgetMs; elapsedMs=0; initialActiveCount=$null; finalActiveCount=$null; initialMembers=@(); finalMembers=@(); failure=$null; observedAt=$null; snapshots=$snapshots }
    try {
        do {
            $exitPid = 0
            $exitRequest = Join-Path $config.evidenceDirectory 'probe-exit.request'
            if ($Fault -eq 'exited-member') { $exitPid = [int]((Get-Content -LiteralPath (Join-Path $config.evidenceDirectory 'probe-identity.json') -Raw | ConvertFrom-Json).pid) }
            $snapshot = [DpfConsoleFixture]::ObserveJob($Fault,$exitPid,$exitRequest)
            $entry = @{ observedAt=[DateTime]::UtcNow.ToString('o'); elapsedMs=$elapsed.ElapsedMilliseconds; activeCount=$snapshot.activeCount; members=@($snapshot.members); failure=$snapshot.failure; failureOperation=$snapshot.failureOperation; failureNativeError=$snapshot.failureNativeError; failurePid=$snapshot.failurePid; failureIdentity=$snapshot.failureIdentity; cleanupFailure=$snapshot.cleanupFailure; cleanupNativeError=$snapshot.cleanupNativeError; probeExitedIdentity=$snapshot.probeExitedIdentity }
            $snapshots.Add($entry)
            foreach ($field in @('failureOperation','failureNativeError','failurePid','failureIdentity','cleanupFailure','cleanupNativeError')) { $result[$field]=$entry[$field] }
            if ($snapshots.Count -eq 1) { $result.initialActiveCount=$entry.activeCount; $result.initialMembers=$entry.members }
            $result.finalActiveCount=$entry.activeCount; $result.finalMembers=$entry.members; $result.observedAt=$entry.observedAt
            $result.elapsedMs=$elapsed.ElapsedMilliseconds
            Write-FixtureJson 'job-drain-progress.json' $result
            if ($snapshot.failure) { throw $snapshot.failure }
            if ($snapshot.activeCount -eq 0 -and $snapshot.members.Length -eq 0 -and $result.elapsedMs -lt $budgetMs) {
                $result.outcome='naturally-empty'
                break
            }
            if ($result.elapsedMs -ge $budgetMs) { break }
            if ($config.jobProbe.kind -in @('short-lived','driver-failure')) {
                [IO.File]::WriteAllText((Join-Path $config.evidenceDirectory 'probe-exit.request'), 'observed owned child')
            }
            Start-Sleep -Milliseconds ([Math]::Min(25,$budgetMs-$result.elapsedMs))
        } while ($elapsed.ElapsedMilliseconds -lt $budgetMs)
    } catch { $result.outcome='observation-failed'; $result.failure=$_.Exception.Message }
    $result.elapsedMs=$elapsed.ElapsedMilliseconds
    if ($result.outcome -eq 'naturally-empty' -and $result.elapsedMs -ge $budgetMs) { $result.outcome='timed-out' }
    Write-FixtureJson 'job-drain-progress.json' $result
    return $result
}

if (-not $Driver) {
    $process = $null
    $failure = $null
    $jobDrain = $null
    try {
        if ($config.jobProbe.kind -eq 'empty') { [DpfConsoleFixture]::CreateOwnedJob() }
        else {
            $arguments = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File ' + [DpfConsoleFixture]::Quote($PSCommandPath) + ' -Configuration ' + [DpfConsoleFixture]::Quote($Configuration) + ' -Driver'
            $process = [DpfConsoleFixture]::Launch((Join-Path $PSHOME 'powershell.exe'), $arguments, $config.worktree, $true)
            Write-FixtureJson 'launcher.json' @{ driverPid=$process.Id; driverBirth=$process.StartTime.ToUniversalTime().Ticks }
            $deadline = [DateTime]::UtcNow.AddSeconds(150)
            while (-not $process.WaitForExit(100)) {
                if (Test-Path -LiteralPath (Join-Path $config.evidenceDirectory 'abort.request')) { throw 'Parent requested fixture emergency cleanup' }
                if ([DateTime]::UtcNow -ge $deadline) { throw 'Private console driver exceeded 150 seconds' }
            }
            if ($process.ExitCode -ne 0) { $failure='Private console driver exit ' + $process.ExitCode }
        }
    } catch { $failure = $_.Exception.Message }
    finally {
        # The driver may have failed while the native writer is still settling.
        # Observe before the first destructive cleanup and retain both outcomes.
        try { $jobDrain = Wait-OwnedJobClosure ([string]$config.jobProbe.kind) }
        catch { $jobDrain=@{ outcome='observation-failed'; failure=$_.Exception.Message }; if (-not $failure) { $failure=$_.Exception.Message } }
        if ($jobDrain.outcome -ne 'naturally-empty' -and -not $failure) { $failure='Owned Job natural closure ' + $jobDrain.outcome + ': ' + $jobDrain.failure }
        $emergency = $null
        $cleanupFailure = $null
        $cleanupStartedAt = [DateTime]::UtcNow.ToString('o')
        try { $emergency = [DpfConsoleFixture]::CleanupOwned() }
        catch { $cleanupFailure=$_.Exception.Message; if (-not $failure) { $failure=$cleanupFailure } }
        if ($emergency -and -not $failure) { $failure='Owned Job required emergency cleanup' }
        Write-FixtureJson 'launcher-result.json' @{ failure=$failure; emergencyCleanup=$emergency; cleanupFailure=$cleanupFailure; cleanupStartedAt=$cleanupStartedAt; cleanupCompletedAt=[DateTime]::UtcNow.ToString('o'); jobDrain=$jobDrain }
    }
    if ($failure) { [Console]::Error.WriteLine($failure); exit 1 }
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
    if ($config.jobProbe) {
        if ($config.jobProbe.kind -ne 'empty') {
            $identity = [DpfConsoleFixture]::LaunchJobProbe($config.jobProbe.node, [DpfConsoleFixture]::Quote($config.jobProbe.child), $config.worktree)
            $probePid = [int]($identity.Split(':')[0])
            $readyDeadline = [DateTime]::UtcNow.AddSeconds(5)
            while (-not (Test-Path -LiteralPath (Join-Path $config.evidenceDirectory 'probe-heartbeat.txt'))) {
                if ([DateTime]::UtcNow -ge $readyDeadline) { throw 'Owned Job probe did not become ready' }
                Start-Sleep -Milliseconds 25
            }
            Write-FixtureJson 'probe-identity.json' @{ identity=$identity; pid=$probePid; consoleMember=([DpfConsoleFixture]::Members() -contains $probePid) }
        }
    } else {
    $quoted = @($config.arguments | ForEach-Object { [DpfConsoleFixture]::Quote([string]$_) })
    $command = '/d /s /c "' + [DpfConsoleFixture]::Quote($config.pnpm) + ' ' + ($quoted -join ' ') + '"'
    $target = [DpfConsoleFixture]::Launch($env:ComSpec, $command, $config.worktree, $false)
    Write-FixtureJson 'driver-ready.json' @{ driverPid=$PID; targetPid=$target.Id; targetBirth=$target.StartTime.ToUniversalTime().Ticks }
    # The parent waits up to 60s for the trusted child, and that wait starts
    # after this process is already running. 120s covers that wait plus the
    # Ctrl+C settlement that follows.
    $deadline = [DateTime]::UtcNow.AddSeconds(120)
    while (-not $target.HasExited) {
        if ([DateTime]::UtcNow -ge $deadline) { throw 'Private console target exceeded 120 seconds' }
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
    # Keep an early diagnostic snapshot. The launcher owns the final bounded
    # Job settlement; this console inventory must never terminate a writer.
    $closureDeadline = [DateTime]::UtcNow.AddSeconds(2)
    do {
        $live = [DpfConsoleFixture]::LiveRetained()
        if ($live.Count -eq 0) { break }
        Start-Sleep -Milliseconds 50
    } while ([DateTime]::UtcNow -lt $closureDeadline)
    }
} catch { $failure = $_.Exception.Message }
finally {
    $cleanupFailure = $null
    try {
        $exitCode = if ($target -and $target.HasExited) { $target.ExitCode } else { $null }
        Write-FixtureJson 'driver-result.json' @{ failure=$failure; exitCode=$exitCode; sent=$sent; controlWitnessCount=[DpfConsoleFixture]::ControlCount; batchConfirmed=$confirmed; members=$before; liveBeforeHarnessCleanup=$live; observedAt=[DateTime]::UtcNow.ToString('o'); screen=$screen }
    } catch { if (-not $failure) { $failure=$_.Exception.Message } }
    finally {
        try {
            [DpfConsoleFixture]::ReleaseRetained()
            if ($config.jobProbe.kind -eq 'driver-failure') { throw 'Injected driver handle-release failure after handles closed' }
        } catch { $cleanupFailure=$_.Exception.Message; if (-not $failure) { $failure=$cleanupFailure } }
        try { Write-FixtureJson 'driver-cleanup.json' @{ emergencyCleanup=$false; outcome=$(if ($cleanupFailure) { 'release-failed' } else { 'handles-released' }); failure=$cleanupFailure; completedAt=[DateTime]::UtcNow.ToString('o') } }
        catch { if (-not $failure) { $failure=$_.Exception.Message }; [Console]::Error.WriteLine($_.Exception.Message) }
    }
}
if ($failure) { [Console]::Error.WriteLine($failure); exit 1 }
exit 0
