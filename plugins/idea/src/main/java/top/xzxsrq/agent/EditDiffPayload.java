package top.xzxsrq.agent;

/**
 * 编辑前后对比载荷。
 * <p>
 * 来源：plugin.html 点击编辑记录“查看对比”后传入 IDEA 宿主桥接。
 *
 * @param filePath 被编辑文件绝对路径或项目内路径。
 * @param beforeContent 编辑前内容。
 * @param afterContent 编辑后内容。
 * @param title 对比窗口标题。
 */
public record EditDiffPayload(
        String filePath,
        String beforeContent,
        String afterContent,
        String title
) {
}
