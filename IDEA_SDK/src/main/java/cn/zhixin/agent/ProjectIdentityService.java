package cn.zhixin.agent;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.UUID;

/**
 * 项目身份服务。
 * <p>
 * 负责读取或创建项目根目录下的“致心项目ID.md”，保证项目迁移后仍能被中心服务识别为同一个项目。
 */
public final class ProjectIdentityService {
    /** PROJECT_ID_FILE_NAME：项目根目录中的固定项目 ID 文件名。 */
    public static final String PROJECT_ID_FILE_NAME = "致心项目ID.md";

    /**
     * readOrCreate：读取已有项目 ID，缺失时创建新的 UUID 并写入项目根目录。
     *
     * @param projectRoot 项目根目录绝对路径。
     * @return 项目身份信息。
     * @throws IOException 项目 ID 文件读写失败时抛出。
     */
    public ProjectIdentity readOrCreate(Path projectRoot) throws IOException {
        // normalizedRoot：统一转为绝对规范路径，避免同一项目路径表示不一致。
        Path normalizedRoot = projectRoot.toAbsolutePath().normalize();
        // idFile：项目身份文件必须位于项目根目录。
        Path idFile = normalizedRoot.resolve(PROJECT_ID_FILE_NAME);
        // projectId：存在则读取，不存在则创建 UUID。
        String projectId = Files.exists(idFile) ? readProjectId(idFile) : createProjectId(idFile);
        // displayName：默认使用项目文件夹名，根路径没有文件名时使用完整路径避免空指针。
        String displayName = normalizedRoot.getFileName() == null
                ? normalizedRoot.toString()
                : normalizedRoot.getFileName().toString();
        // ProjectIdentity：返回给 IDEA 插件后续连接中心服务使用。
        return new ProjectIdentity(projectId, displayName, normalizedRoot.toString());
    }

    /**
     * readProjectId：读取项目 ID 文件中的 UUID 文本。
     *
     * @param idFile 项目 ID 文件路径。
     * @return 去除空白后的项目 ID。
     * @throws IOException 读取失败时抛出。
     */
    private String readProjectId(Path idFile) throws IOException {
        // content：使用 UTF-8 读取中文文件名对应的 Markdown 内容。
        String content = new String(Files.readAllBytes(idFile), StandardCharsets.UTF_8);
        // trim：项目 ID 文件只保存 UUID 文本，允许末尾换行。
        return content.trim();
    }

    /**
     * createProjectId：生成 UUID 并写入项目 ID 文件。
     *
     * @param idFile 项目 ID 文件路径。
     * @return 新生成的项目 ID。
     * @throws IOException 写入失败时抛出。
     */
    private String createProjectId(Path idFile) throws IOException {
        // projectId：项目身份使用 UUID，不能直接使用项目路径。
        String projectId = UUID.randomUUID().toString();
        // content：末尾追加换行，方便人工查看和版本管理。
        String content = projectId + System.lineSeparator();
        // writeString：使用 UTF-8 写入“致心项目ID.md”。
        Files.write(idFile, content.getBytes(StandardCharsets.UTF_8));
        // projectId：返回给调用方继续连接中心服务。
        return projectId;
    }
}
