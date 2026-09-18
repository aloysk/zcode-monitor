Add-Type @"
using System;
using System.Runtime.InteropServices;
public class D3 {
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr v);
  public delegate bool EnumWindowsProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h, System.Text.StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out R r);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [StructLayout(LayoutKind.Sequential)] public struct R { public int L, T, Rt, B; }
}
"@
[D3]::SetProcessDpiAwarenessContext([IntPtr](-4)) | Out-Null
$proc = Get-Process ZcodeWidget -ErrorAction Stop
$script:rows = @()
$cb = {
  param($h, $l)
  $wpid = 0
  [D3]::GetWindowThreadProcessId($h, [ref]$wpid) | Out-Null
  if ($wpid -eq $proc.Id) {
    $r = New-Object D3+R
    [D3]::GetWindowRect($h, [ref]$r) | Out-Null
    $sb = New-Object System.Text.StringBuilder 256
    [D3]::GetClassName($h, $sb, 256) | Out-Null
    $script:rows += ("hwnd=0x{0:X} vis={1} class={2} rect=({3},{4})-({5},{6}) size={7}x{8}" -f $h.ToInt64(), [D3]::IsWindowVisible($h), $sb.ToString(), $r.L, $r.T, $r.Rt, $r.B, ($r.Rt-$r.L), ($r.B-$r.T))
  }
  return $true
}
[D3]::EnumWindows($cb, [IntPtr]::Zero) | Out-Null
$script:rows
