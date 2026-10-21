using System;
using System.IO;
using System.Runtime.InteropServices;

// Use Windows' recoverable delete operation. Never fall back to File.Delete.
internal static class RecycleBridge
{
    [DllImport("shell32.dll", CharSet=CharSet.Unicode, PreserveSig=false)]
    static extern void SHCreateItemFromParsingName(string path, IntPtr context, ref Guid iid,
        [MarshalAs(UnmanagedType.Interface)] out IShellItem item);

    [STAThread]
    static int Main(string[] args)
    {
        IShellItem item=null; IFileOperation operation=null;
        try
        {
            if(args.Length!=1 || !Path.IsPathRooted(args[0])) throw new Exception("Choose an absolute Windows path.");
            string path=Path.GetFullPath(args[0]);
            string root=Path.GetPathRoot(path);
            if(String.Equals(path.TrimEnd('\\','/'),root.TrimEnd('\\','/'),StringComparison.OrdinalIgnoreCase))
                throw new Exception("A drive cannot be moved to the Recycle Bin.");
            if(root.StartsWith("\\\\") || new DriveInfo(root).DriveType!=DriveType.Fixed)
                throw new Exception("Recycle Bin is supported here only on local fixed drives.");
            if(!File.Exists(path) && !Directory.Exists(path)) throw new Exception("This file or folder is no longer available.");
            Guid iid=new Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE");
            SHCreateItemFromParsingName(path,IntPtr.Zero,ref iid,out item);
            operation=(IFileOperation)Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid("3AD05575-8857-4850-9277-11B85BDB8E09")));
            // RECYCLEONDELETE, ADDUNDORECORD, EARLYFAILURE, NOERRORUI, SILENT,
            // NOCONFIRMATION, NO_CONNECTED_ELEMENTS (only the selected item).
            operation.SetOperationFlags(0x00080000|0x20000000|0x00100000|0x0400|0x0004|0x0010|0x2000);
            var sink=new RecycleSink();
            operation.DeleteItem(item,sink);
            operation.PerformOperations();
            bool aborted; operation.GetAnyOperationsAborted(out aborted);
            if(sink.Refused) throw new Exception("Windows cannot recycle this item. It was left in place.");
            if(sink.Error<0) Marshal.ThrowExceptionForHR(sink.Error);
            if(aborted || !sink.Recycled) throw new Exception("Windows did not move this item to the Recycle Bin.");
            return 0;
        }
        catch(Exception error) { Console.Error.WriteLine("Could not recycle: "+error.Message); return 1; }
        finally
        {
            if(operation!=null) Marshal.ReleaseComObject(operation);
            if(item!=null) Marshal.ReleaseComObject(item);
        }
    }
}

[ComImport, Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IShellItem { }

[ComImport, Guid("947AAB5F-0A5C-4C13-B4D6-4BF7836FC9F8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IFileOperation
{
    void Advise(IFileOperationProgressSink sink,out uint cookie);
    void Unadvise(uint cookie);
    void SetOperationFlags(uint flags);
    void SetProgressMessage([MarshalAs(UnmanagedType.LPWStr)] string message);
    void SetProgressDialog([MarshalAs(UnmanagedType.Interface)] object dialog);
    void SetProperties([MarshalAs(UnmanagedType.Interface)] object properties);
    void SetOwnerWindow(IntPtr window);
    void ApplyPropertiesToItem(IShellItem item);
    void ApplyPropertiesToItems(IShellItem items);
    void RenameItem(IShellItem item,[MarshalAs(UnmanagedType.LPWStr)] string name,IFileOperationProgressSink sink);
    void RenameItems(IShellItem items,[MarshalAs(UnmanagedType.LPWStr)] string name);
    void MoveItem(IShellItem item,IShellItem folder,[MarshalAs(UnmanagedType.LPWStr)] string name,IFileOperationProgressSink sink);
    void MoveItems(IShellItem items,IShellItem folder);
    void CopyItem(IShellItem item,IShellItem folder,[MarshalAs(UnmanagedType.LPWStr)] string name,IFileOperationProgressSink sink);
    void CopyItems(IShellItem items,IShellItem folder);
    void DeleteItem(IShellItem item,IFileOperationProgressSink sink);
    void DeleteItems(IShellItem items);
    void NewItem(IShellItem folder,uint attributes,[MarshalAs(UnmanagedType.LPWStr)] string name,[MarshalAs(UnmanagedType.LPWStr)] string template,IFileOperationProgressSink sink);
    void PerformOperations();
    void GetAnyOperationsAborted([MarshalAs(UnmanagedType.Bool)] out bool aborted);
}

[ComVisible(true), Guid("04B0F1A7-9490-44BC-96E1-4296A31252E2"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IFileOperationProgressSink
{
    [PreserveSig] int StartOperations();
    [PreserveSig] int FinishOperations(int result);
    [PreserveSig] int PreRenameItem(uint flags,IntPtr item,[MarshalAs(UnmanagedType.LPWStr)] string name);
    [PreserveSig] int PostRenameItem(uint flags,IntPtr item,[MarshalAs(UnmanagedType.LPWStr)] string name,int result,IntPtr newItem);
    [PreserveSig] int PreMoveItem(uint flags,IntPtr item,IntPtr folder,[MarshalAs(UnmanagedType.LPWStr)] string name);
    [PreserveSig] int PostMoveItem(uint flags,IntPtr item,IntPtr folder,[MarshalAs(UnmanagedType.LPWStr)] string name,int result,IntPtr newItem);
    [PreserveSig] int PreCopyItem(uint flags,IntPtr item,IntPtr folder,[MarshalAs(UnmanagedType.LPWStr)] string name);
    [PreserveSig] int PostCopyItem(uint flags,IntPtr item,IntPtr folder,[MarshalAs(UnmanagedType.LPWStr)] string name,int result,IntPtr newItem);
    [PreserveSig] int PreDeleteItem(uint flags,IntPtr item);
    [PreserveSig] int PostDeleteItem(uint flags,IntPtr item,int result,IntPtr newItem);
    [PreserveSig] int PreNewItem(uint flags,IntPtr folder,[MarshalAs(UnmanagedType.LPWStr)] string name);
    [PreserveSig] int PostNewItem(uint flags,IntPtr folder,[MarshalAs(UnmanagedType.LPWStr)] string name,[MarshalAs(UnmanagedType.LPWStr)] string template,uint attributes,int result,IntPtr newItem);
    [PreserveSig] int UpdateProgress(uint total,uint completed);
    [PreserveSig] int ResetTimer();
    [PreserveSig] int PauseTimer();
    [PreserveSig] int ResumeTimer();
}

[ComVisible(true), ClassInterface(ClassInterfaceType.None)]
internal sealed class RecycleSink : IFileOperationProgressSink
{
    public bool Refused, Recycled;
    public int Error;
    public int PreDeleteItem(uint flags,IntPtr item)
    {
        // Reject a permanent-delete fallback before Windows touches the item.
        if((flags&0x80)==0) { Refused=true; return unchecked((int)0x80004004); }
        return 0;
    }
    public int PostDeleteItem(uint flags,IntPtr item,int result,IntPtr newItem)
    { Error=result; Recycled=result>=0 && newItem!=IntPtr.Zero; return 0; }
    public int StartOperations(){return 0;}
    public int FinishOperations(int result){if(result<0)Error=result;return 0;}
    public int PreRenameItem(uint f,IntPtr i,string n){return 0;}
    public int PostRenameItem(uint f,IntPtr i,string n,int r,IntPtr j){return 0;}
    public int PreMoveItem(uint f,IntPtr i,IntPtr d,string n){return 0;}
    public int PostMoveItem(uint f,IntPtr i,IntPtr d,string n,int r,IntPtr j){return 0;}
    public int PreCopyItem(uint f,IntPtr i,IntPtr d,string n){return 0;}
    public int PostCopyItem(uint f,IntPtr i,IntPtr d,string n,int r,IntPtr j){return 0;}
    public int PreNewItem(uint f,IntPtr d,string n){return 0;}
    public int PostNewItem(uint f,IntPtr d,string n,string t,uint a,int r,IntPtr j){return 0;}
    public int UpdateProgress(uint t,uint c){return 0;}
    public int ResetTimer(){return 0;}
    public int PauseTimer(){return 0;}
    public int ResumeTimer(){return 0;}
}
