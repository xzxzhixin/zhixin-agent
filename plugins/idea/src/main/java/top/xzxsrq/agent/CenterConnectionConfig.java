package top.xzxsrq.agent;

/**
 * 中心服务连接配置。
 * <p>
 * IDEA 插件只能连接本机 127.0.0.1，通过端口拼出中心服务地址，不能使用账号密码或暴露 API Key。
 */
public final class CenterConnectionConfig {
    /** DEFAULT_PORT：IDEA 插件默认连接端口。 */
    public static final int DEFAULT_PORT = 8866;
    /** port：中心服务端口，默认值来自项目需求。 */
    private final int port;

    /**
     * CenterConnectionConfig：创建中心服务连接配置。
     *
     * @param port 中心服务端口，默认 8866。
     */
    public CenterConnectionConfig(int port) {
        // port：IDEA 插件只能拼接本机 127.0.0.1 地址。
        this.port = port;
    }

    /**
     * defaultConfig：创建默认连接配置。
     *
     * @return 默认端口的连接配置。
     */
    public static CenterConnectionConfig defaultConfig() {
        // DEFAULT_PORT：IDEA 插件默认连接 http://127.0.0.1:8866。
        return new CenterConnectionConfig(DEFAULT_PORT);
    }

    /**
     * baseUrl：生成中心服务基础地址。
     *
     * @return http://127.0.0.1:端口 格式的地址。
     */
    public String baseUrl() {
        // 127.0.0.1：IDEA 插件只能连接本机中心服务。
        return "http://127.0.0.1:" + port;
    }

    /**
     * port：读取中心服务端口。
     *
     * @return 中心服务端口。
     */
    public int port() {
        // port：保持 record 风格访问方法，减少调用方改动。
        return port;
    }
}

