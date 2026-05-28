package cn.zhixin.agent;

/**
 * 上下文引用类型。
 * <p>
 * 用于区分发送到致心对话框输入区的是文件、文件夹还是代码行范围。
 */
public enum ContextReferenceType {
    /** FILE：项目文件树或编辑器标签页中的文件引用。 */
    FILE,
    /** DIRECTORY：项目文件树中的文件夹引用。 */
    DIRECTORY,
    /** CODE：编辑器选区或当前行代码引用。 */
    CODE
}
