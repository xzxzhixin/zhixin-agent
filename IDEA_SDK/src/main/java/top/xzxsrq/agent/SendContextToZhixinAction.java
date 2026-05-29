package top.xzxsrq.agent;

import com.intellij.openapi.actionSystem.ActionUpdateThread;
import com.intellij.openapi.actionSystem.AnAction;
import com.intellij.openapi.actionSystem.AnActionEvent;
import com.intellij.openapi.actionSystem.CommonDataKeys;
import com.intellij.openapi.editor.Document;
import com.intellij.openapi.editor.Editor;
import com.intellij.openapi.editor.SelectionModel;
import com.intellij.openapi.fileEditor.FileDocumentManager;
import com.intellij.openapi.project.DumbAware;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.vfs.VirtualFile;

import java.nio.file.Paths;
import java.util.Collections;

/**
 * 发送上下文到致心对话框的 IDEA Action。
 * <p>
 * 支持编辑器选区、编辑器标签页和项目文件树右键入口，只插入上下文引用，不直接发送提问。
 */
public final class SendContextToZhixinAction extends AnAction implements DumbAware {
    /** referenceFactory：把 IDEA 选择内容转换为中心服务上下文引用。 */
    private final ContextReferenceFactory referenceFactory = new ContextReferenceFactory();

    /**
     * getActionUpdateThread：声明 update 在后台线程运行。
     *
     * @return IDEA Action 更新线程。
     */
    @Override
    public ActionUpdateThread getActionUpdateThread() {
        // BGT：只读取数据上下文，不触碰 Swing 组件状态。
        return ActionUpdateThread.BGT;
    }

    /**
     * update：根据当前上下文决定菜单项是否可用。
     *
     * @param event IDEA Action 事件。
     */
    @Override
    public void update(AnActionEvent event) {
        // project：没有项目时不能归属项目会话。
        Project project = event.getProject();
        // virtualFile：项目树或编辑器标签页中的文件/文件夹。
        VirtualFile virtualFile = event.getData(CommonDataKeys.VIRTUAL_FILE);
        // editor：编辑器选区上下文。
        Editor editor = event.getData(CommonDataKeys.EDITOR);
        // enabled：必须有项目，并且有文件或编辑器可转换为引用。
        boolean enabled = project != null && (virtualFile != null || editor != null);
        // setEnabledAndVisible：无上下文时隐藏入口，避免产生空引用。
        event.getPresentation().setEnabledAndVisible(enabled);
    }

    /**
     * actionPerformed：把当前上下文转换为引用并交给插件桥接层。
     *
     * @param event IDEA Action 事件。
     */
    @Override
    public void actionPerformed(AnActionEvent event) {
        // project：发送引用必须绑定当前 IDEA 项目。
        Project project = event.getProject();
        // project 为空时 update 理论上已禁用，这里防御 ActionSystem 直接调用。
        if (project == null) {
            return;
        }
        // bridge：负责读取项目身份并把载荷交给插件页面。
        ZhixinPluginBridge bridge = new ZhixinPluginBridge(project);
        // identity：项目 ID 来自“致心项目ID.md”。
        ProjectIdentity identity = bridge.currentProjectIdentity();
        // reference：优先使用编辑器选区，其次使用虚拟文件。
        ContextReference reference = createReference(event, identity);
        // reference 为空说明上下文无法转换，直接结束避免发送错误协议。
        if (reference == null) {
            return;
        }
        // payload：右键菜单只插入引用，不直接发起最终提问。
        SendContextActionPayload payload = new SendContextActionPayload(
                identity,
                Collections.singletonList(reference)
        );
        // sendContextToComposer：交由桥接层同步到插件页面输入区。
        bridge.sendContextToComposer(payload);
    }

    /**
     * createReference：把 Action 上下文转换为单个上下文引用。
     *
     * @param event IDEA Action 事件。
     * @param identity 当前项目身份。
     * @return 上下文引用；无法转换时返回 null。
     */
    private ContextReference createReference(AnActionEvent event, ProjectIdentity identity) {
        // editor：编辑器右键时优先按选区或当前行生成代码引用。
        Editor editor = event.getData(CommonDataKeys.EDITOR);
        if (editor != null) {
            // editorReference：从编辑器文档和选区创建代码引用。
            ContextReference editorReference = createEditorReference(identity, editor);
            // editorReference 不为空时无需再读取 VIRTUAL_FILE。
            if (editorReference != null) {
                return editorReference;
            }
        }
        // virtualFile：项目树或编辑器标签页文件上下文。
        VirtualFile virtualFile = event.getData(CommonDataKeys.VIRTUAL_FILE);
        // virtualFile 为空时没有可发送目标。
        if (virtualFile == null) {
            return null;
        }
        // path：VirtualFile 路径转换为 NIO Path 后交给既有工厂。
        java.nio.file.Path path = Paths.get(virtualFile.getPath());
        // directoryReference：文件夹右键发送文件夹引用。
        if (virtualFile.isDirectory()) {
            return referenceFactory.directoryReference(identity, path);
        }
        // fileReference：普通文件右键发送文件引用。
        return referenceFactory.fileReference(identity, path);
    }

    /**
     * createEditorReference：从编辑器选区或当前行创建代码引用。
     *
     * @param identity 当前项目身份。
     * @param editor 当前编辑器。
     * @return 代码引用；无法定位文件时返回 null。
     */
    private ContextReference createEditorReference(ProjectIdentity identity, Editor editor) {
        // document：编辑器文档用于计算行号和选中文本。
        Document document = editor.getDocument();
        // file：通过文档反查 VirtualFile，避免猜测当前文件路径。
        VirtualFile file = FileDocumentManager.getInstance().getFile(document);
        // file 为空时无法建立内部文件定位链接。
        if (file == null) {
            return null;
        }
        // selectionModel：判断是否有真实选区。
        SelectionModel selectionModel = editor.getSelectionModel();
        // startOffset：有选区用选区起点，没有选区用光标位置。
        int startOffset = selectionModel.hasSelection()
                ? selectionModel.getSelectionStart()
                : editor.getCaretModel().getOffset();
        // endOffset：有选区用选区终点，没有选区用光标位置。
        int endOffset = selectionModel.hasSelection()
                ? Math.max(selectionModel.getSelectionEnd() - 1, startOffset)
                : startOffset;
        // startLine：需求协议行号从 1 开始。
        int startLine = document.getLineNumber(startOffset) + 1;
        // endLine：选区末尾位于下一行起点时，通过 endOffset - 1 归入上一行。
        int endLine = document.getLineNumber(endOffset) + 1;
        // selectedText：无选区时使用当前行文本，保证发送入口有上下文内容。
        String selectedText = selectionModel.hasSelection()
                ? selectionModel.getSelectedText()
                : currentLineText(document, startLine);
        // codeReference：统一生成代码行引用。
        return referenceFactory.codeReference(
                identity,
                Paths.get(file.getPath()),
                startLine,
                endLine,
                selectedText == null ? "" : selectedText
        );
    }

    /**
     * currentLineText：读取当前行文本。
     *
     * @param document 当前编辑器文档。
     * @param oneBasedLine 1 基行号。
     * @return 当前行文本。
     */
    private String currentLineText(Document document, int oneBasedLine) {
        // lineIndex：Document API 使用 0 基行号。
        int lineIndex = Math.max(oneBasedLine - 1, 0);
        // startOffset：当前行起始偏移。
        int startOffset = document.getLineStartOffset(lineIndex);
        // endOffset：当前行结束偏移。
        int endOffset = document.getLineEndOffset(lineIndex);
        // getText：返回当前行文本，作为无选区时的上下文内容。
        return document.getText().substring(startOffset, endOffset);
    }
}
