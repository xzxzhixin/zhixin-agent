package top.xzxsrq.agent;

import java.nio.file.Path;

/**
 * 上下文引用工厂。
 * <p>
 * 将 IDEA 编辑器、编辑器标签页和项目文件树中的选择转换为中心服务可识别的结构化引用。
 */
public final class ContextReferenceFactory {
    /**
     * fileReference：创建文件引用。
     *
     * @param identity 项目身份信息。
     * @param filePath 文件绝对路径。
     * @return 文件上下文引用。
     */
    public ContextReference fileReference(ProjectIdentity identity, Path filePath) {
        // relativePath：中心服务同步时保留项目内相对路径。
        String relativePath = relativePath(identity, filePath);
        // displayText：文件引用标签展示文件名。
        String displayText = filePath.getFileName().toString();
        // ContextReference：文件引用不携带行号和选中文本。
        return new ContextReference(
                ContextReferenceType.FILE,
                identity.projectId(),
                filePath.toAbsolutePath().normalize().toString(),
                relativePath,
                displayText,
                0,
                0,
                ""
        );
    }

    /**
     * directoryReference：创建文件夹引用。
     *
     * @param identity 项目身份信息。
     * @param directoryPath 文件夹绝对路径。
     * @return 文件夹上下文引用。
     */
    public ContextReference directoryReference(ProjectIdentity identity, Path directoryPath) {
        // relativePath：文件夹同样保留相对项目路径，便于中心服务迁移识别。
        String relativePath = relativePath(identity, directoryPath);
        // displayText：文件夹引用标签展示文件夹名。
        String displayText = directoryPath.getFileName().toString();
        // ContextReference：文件夹引用不携带行号和选中文本。
        return new ContextReference(
                ContextReferenceType.DIRECTORY,
                identity.projectId(),
                directoryPath.toAbsolutePath().normalize().toString(),
                relativePath,
                displayText,
                0,
                0,
                ""
        );
    }

    /**
     * codeReference：创建代码行引用。
     *
     * @param identity 项目身份信息。
     * @param filePath 文件绝对路径。
     * @param startLine 选区起始行号，从 1 开始。
     * @param endLine 选区结束行号，从 1 开始。
     * @param selectedText 选中的代码内容。
     * @return 代码上下文引用。
     */
    public ContextReference codeReference(
            ProjectIdentity identity,
            Path filePath,
            int startLine,
            int endLine,
            String selectedText
    ) {
        // relativePath：代码引用需要保留相对路径，避免同名文件无法判断。
        String relativePath = relativePath(identity, filePath);
        // lineText：单行和多行使用不同展示格式。
        String lineText = startLine == endLine ? "#L" + startLine : "#L" + startLine + "-" + endLine;
        // displayText：代码行引用显示为 文件名#L行号 或 文件名#L开始行-结束行。
        String displayText = filePath.getFileName() + lineText;
        // ContextReference：代码引用保留行号和选中文本。
        return new ContextReference(
                ContextReferenceType.CODE,
                identity.projectId(),
                filePath.toAbsolutePath().normalize().toString(),
                relativePath,
                displayText,
                startLine,
                endLine,
                selectedText
        );
    }

    /**
     * relativePath：计算相对项目根目录路径。
     *
     * @param identity 项目身份信息。
     * @param targetPath 目标文件或文件夹路径。
     * @return 相对项目根目录的路径。
     */
    private String relativePath(ProjectIdentity identity, Path targetPath) {
        // rootPath：项目根目录来自项目身份，不能从当前工作目录猜测。
        Path rootPath = java.nio.file.Paths.get(identity.rootPath()).toAbsolutePath().normalize();
        // normalizedTarget：目标路径规范化，避免出现 ../ 等不稳定片段。
        Path normalizedTarget = targetPath.toAbsolutePath().normalize();
        // relativize：IDEA 插件发送给中心服务的是项目相对路径。
        return rootPath.relativize(normalizedTarget).toString();
    }
}

