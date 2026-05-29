package top.xzxsrq.agent;

import com.intellij.openapi.project.DumbAware;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.wm.ToolWindow;
import com.intellij.openapi.wm.ToolWindowFactory;
import com.intellij.ui.content.Content;
import com.intellij.ui.content.ContentFactory;
import com.intellij.ui.jcef.JBCefBrowser;

import javax.swing.JComponent;
import javax.swing.JLabel;
import javax.swing.JPanel;
import java.awt.BorderLayout;

/**
 * 致心工具窗口工厂。
 * <p>
 * IDEA 打开工具窗口时加载中心服务提供的 plugin.html，作为插件页面统一入口。
 */
public final class ZhixinToolWindowFactory implements ToolWindowFactory, DumbAware {
    /**
     * createToolWindowContent：创建“致心”工具窗口内容。
     *
     * @param project 当前 IDEA 项目。
     * @param toolWindow IDEA 工具窗口实例。
     */
    @Override
    public void createToolWindowContent(Project project, ToolWindow toolWindow) {
        // bridge：工具窗口需要通过桥接对象获取中心服务 plugin.html 地址。
        ZhixinPluginBridge bridge = new ZhixinPluginBridge(project);
        // component：优先创建 JCEF 浏览器，缺失时展示可读错误。
        JComponent component = createBrowserComponent(bridge);
        // content：工具窗口只承载一个插件页面入口。
        Content content = ContentFactory.getInstance().createContent(component, "致心", false);
        // addContent：把页面挂入 IDEA 工具窗口。
        toolWindow.getContentManager().addContent(content);
    }

    /**
     * createBrowserComponent：创建中心服务插件页面浏览器。
     *
     * @param bridge 当前项目插件桥接对象。
     * @return 可加入工具窗口的 Swing 组件。
     */
    private JComponent createBrowserComponent(ZhixinPluginBridge bridge) {
        try {
            // browser：JCEF 直接加载中心服务提供的 plugin.html。
            JBCefBrowser browser = new JBCefBrowser(bridge.pluginPageUrl());
            // component：返回浏览器 Swing 组件。
            return browser.getComponent();
        } catch (Throwable throwable) {
            // panel：JCEF 不可用时不要让工具窗口空白，给出明确处理方向。
            JPanel panel = new JPanel(new BorderLayout());
            // label：说明中心服务地址和 JCEF 初始化失败原因。
            JLabel label = new JLabel("无法加载致心插件页面：" + throwable.getMessage());
            // add：让用户能在工具窗口看到失败原因。
            panel.add(label, BorderLayout.NORTH);
            // panel：返回降级提示组件。
            return panel;
        }
    }
}
