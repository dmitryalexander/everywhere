using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;

// Opens the requested folder/file using the Windows Shell, then focuses that
// exact Explorer window. No title matching: two same-named folders stay distinct.
internal static class ExplorerBridge
{
    [DllImport("shell32.dll", CharSet=CharSet.Unicode)]
    static extern int SHParseDisplayName(string path, IntPtr binding, out IntPtr pidl, uint attributes, out uint result);
    [DllImport("shell32.dll")]
    static extern int SHOpenFolderAndSelectItems(IntPtr folder, uint count, IntPtr[] items, uint flags);
    [DllImport("shell32.dll")]
    static extern IntPtr ILFindLastID(IntPtr pidl);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
    [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")] static extern bool AttachThreadInput(uint from, uint to, bool attach);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr window);
    [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr window);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr window, int command);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr window);

    static string Normalize(string path) { return Path.GetFullPath(path).TrimEnd('\\', '/'); }
    static bool HasSelectedFile(dynamic window, string path)
    {
        dynamic selected = window.Document.SelectedItems();
        try
        {
            foreach (dynamic item in selected)
            {
                try { if (String.Equals(Normalize((string)item.Path), Normalize(path), StringComparison.OrdinalIgnoreCase)) return true; }
                finally { Marshal.ReleaseComObject(item); }
            }
            return false;
        }
        finally { Marshal.ReleaseComObject(selected); }
    }
    static IntPtr FindWindow(dynamic shell, string folder, string selectedFile)
    {
        dynamic windows = shell.Windows();
        try
        {
            foreach (dynamic window in windows)
            {
                try
                {
                    string executable = window.FullName;
                    if (!String.Equals(Path.GetFileName(executable), "explorer.exe", StringComparison.OrdinalIgnoreCase)) continue;
                    string location = window.LocationURL;
                    Uri uri;
                    if (Uri.TryCreate(location, UriKind.Absolute, out uri) && uri.IsFile &&
                        String.Equals(Normalize(uri.LocalPath), Normalize(folder), StringComparison.OrdinalIgnoreCase) &&
                        (selectedFile == null || HasSelectedFile(window, selectedFile)))
                        return new IntPtr((long)window.HWND);
                }
                catch (COMException) { }
                finally { if (Marshal.IsComObject(window)) Marshal.ReleaseComObject(window); }
            }
            return IntPtr.Zero;
        }
        finally { Marshal.ReleaseComObject(windows); }
    }
    static bool Focus(IntPtr window)
    {
        if (IsIconic(window)) ShowWindow(window, 9); // Restore minimized windows.
        if (SetForegroundWindow(window) || GetForegroundWindow() == window) return true;
        uint unused;
        uint own = GetCurrentThreadId();
        uint foreground = GetWindowThreadProcessId(GetForegroundWindow(), out unused);
        uint target = GetWindowThreadProcessId(window, out unused);
        bool attachedForeground = foreground != 0 && foreground != own && AttachThreadInput(own, foreground, true);
        bool attachedTarget = target != 0 && target != own && target != foreground && AttachThreadInput(own, target, true);
        try { BringWindowToTop(window); SetForegroundWindow(window); return GetForegroundWindow() == window; }
        finally
        {
            if (attachedTarget) AttachThreadInput(own, target, false);
            if (attachedForeground) AttachThreadInput(own, foreground, false);
        }
    }
    [STAThread]
    static int Main(string[] args)
    {
        if (args.Length != 1) return 1;
        IntPtr folderId = IntPtr.Zero, fileId = IntPtr.Zero;
        object shell = null;
        try
        {
            string path = Path.GetFullPath(args[0]);
            bool isFolder = Directory.Exists(path);
            if (!isFolder && !File.Exists(path)) return 1;
            string folder = isFolder ? path : Path.GetDirectoryName(path);
            shell = Activator.CreateInstance(Type.GetTypeFromProgID("Shell.Application"));
            uint attributes;
            if (isFolder)
            {
                IntPtr existing = FindWindow(shell, folder, null);
                if (existing != IntPtr.Zero && Focus(existing)) return 0;
                ((dynamic)shell).Explore(folder);
            }
            else
            {
                Marshal.ThrowExceptionForHR(SHParseDisplayName(folder, IntPtr.Zero, out folderId, 0, out attributes));
                Marshal.ThrowExceptionForHR(SHParseDisplayName(path, IntPtr.Zero, out fileId, 0, out attributes));
                Marshal.ThrowExceptionForHR(SHOpenFolderAndSelectItems(folderId, 1u, new[] { ILFindLastID(fileId) }, 0));
            }
            for (int i = 0; i < 50; i++)
            {
                IntPtr window = FindWindow(shell, folder, isFolder ? null : path);
                if (window != IntPtr.Zero && Focus(window)) return 0;
                Thread.Sleep(100);
            }
            Console.Error.WriteLine("Explorer opened, but Windows did not bring its window to the front.");
            return 2;
        }
        catch (Exception error) { Console.Error.WriteLine(error.Message); return 1; }
        finally
        {
            if (shell != null && Marshal.IsComObject(shell)) Marshal.ReleaseComObject(shell);
            if (fileId != IntPtr.Zero) Marshal.FreeCoTaskMem(fileId);
            if (folderId != IntPtr.Zero) Marshal.FreeCoTaskMem(folderId);
        }
    }
}
