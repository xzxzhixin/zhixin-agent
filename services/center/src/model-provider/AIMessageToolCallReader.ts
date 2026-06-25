import type {BaseMessage} from "@langchain/core/messages";

/**
 * AIMessageToolCall：LangChain AIMessage 工具调用的最小读取结构。
 */
export interface AIMessageToolCall {
    /** id：工具调用 ID，来源于模型返回协议。 */
    id?: string;
    /** name：工具名，来源于模型返回协议。 */
    name: string;
    /** args：工具参数对象，来源于模型返回协议。 */
    args: unknown;
}

/**
 * AIMessageToolCallReader：读取 LangChain AIMessage 上的工具调用。
 *
 * 用途：隔离 LangChain 消息对象的动态字段访问，不通过文本、提示词或工具名猜测工具调用。
 */
export class AIMessageToolCallReader {
    /**
     * hasToolCalls：判断消息是否带工具调用。
     *
     * @param message LangChain 消息。
     * @returns 存在工具调用时返回 true。
     */
    public hasToolCalls(message: BaseMessage): boolean {
        return "tool_calls" in message && Array.isArray(message.tool_calls);
    }

    /**
     * readToolCalls：读取工具调用数组。
     *
     * @param message LangChain 消息。
     * @returns 工具调用数组。
     */
    public readToolCalls(message: BaseMessage): AIMessageToolCall[] {
        if (!this.hasToolCalls(message)) {
            return [];
        }
        return message.tool_calls as AIMessageToolCall[];
    }
}
