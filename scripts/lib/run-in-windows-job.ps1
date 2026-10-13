# Own the command's descendants by kernel job membership, not recycled PIDs.
# The wrapper joins before launching the command; children inherit membership.
# The job handle is non-inheritable and held until this wrapper exits, so a
# fence killing the wrapper also kills its descendants without a process scan.
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;
public static class DpfCommandJob {
    [StructLayout(LayoutKind.Sequential)]
    struct BasicLimits {
        public long PerProcessUserTime, PerJobUserTime;
        public uint Flags;
        public UIntPtr MinimumWorkingSet, MaximumWorkingSet;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass, SchedulingClass;
    }
    [StructLayout(LayoutKind.Sequential)]
    struct IoCounters {
        public ulong ReadOperations, WriteOperations, OtherOperations;
        public ulong ReadBytes, WriteBytes, OtherBytes;
    }
    [StructLayout(LayoutKind.Sequential)]
    struct ExtendedLimits {
        public BasicLimits Basic;
        public IoCounters Io;
        public UIntPtr ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory;
    }
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    static extern IntPtr CreateJobObject(IntPtr security, string name);
    [DllImport("kernel32.dll", SetLastError=true)]
    static extern bool SetInformationJobObject(IntPtr job, int kind, ref ExtendedLimits info, uint size);
    [DllImport("kernel32.dll", SetLastError=true)]
    static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    static IntPtr job;
    public static void Enter() {
        job = CreateJobObject(IntPtr.Zero, null);
        if (job == IntPtr.Zero) throw new Win32Exception();
        var limits = new ExtendedLimits();
        limits.Basic.Flags = 0x2000; // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        if (!SetInformationJobObject(job, 9, ref limits, (uint)Marshal.SizeOf(limits)))
            throw new Win32Exception();
        if (!AssignProcessToJobObject(job, Process.GetCurrentProcess().Handle))
            throw new Win32Exception();
    }
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    static extern IntPtr CreateFile(string path, uint access, uint share, IntPtr security, uint creation, uint flags, IntPtr template);
    [DllImport("kernel32.dll", SetLastError=true)]
    static extern bool SetStdHandle(int which, IntPtr handle);
    static IntPtr childInput;
    static void DetachChildInput() {
        childInput = CreateFile("NUL", 0x80000000, 3, IntPtr.Zero, 3, 0, IntPtr.Zero);
        if (childInput == new IntPtr(-1) || !SetStdHandle(-10, childInput)) throw new Win32Exception();
    }
    public static void WatchParentPipe() {
        // Keep the supervisor pipe private; Git descendants must read from NUL.
        var input = Console.OpenStandardInput();
        DetachChildInput();
        var thread = new Thread(() => {
            while (input.ReadByte() != -1) { }
            // EOF is the owned pipe closing, not a guess about a recycled PID.
            Environment.Exit(75);
        });
        thread.IsBackground = true;
        thread.Start();
    }
}
'@
[DpfCommandJob]::Enter()
[DpfCommandJob]::WatchParentPipe()
$commandSpec = $env:DPF_WINDOWS_JOB_COMMAND | ConvertFrom-Json
Remove-Item Env:DPF_WINDOWS_JOB_COMMAND
if ($commandSpec.kind -eq 'argv') {
    $command = [string]$commandSpec.value[0]
    $commandArgs = @($commandSpec.value | Select-Object -Skip 1)
    & $command @commandArgs
} elseif ($commandSpec.kind -eq 'shell') {
    & $env:ComSpec /d /s /c ([string]$commandSpec.value)
} else {
    throw 'Unsupported gate command kind'
}
$commandExitCode = $LASTEXITCODE
if ($env:DPF_GATE_EXECUTION_CONTEXT) {
    & $env:DPF_GATE_NODE $env:DPF_GATE_CHECKPOINT_WRITER $commandExitCode
    if ($LASTEXITCODE -ne 0) { exit 75 }
}
exit $commandExitCode
