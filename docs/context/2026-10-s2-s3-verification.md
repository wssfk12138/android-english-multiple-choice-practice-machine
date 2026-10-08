# S2/S3 协议、传输能力与验收依据

> 2026-10-08。本页保存实现依据、合成样本和验收方法；阶段完成状态以[阶段回执](2026-10-integrated-progress.md)为准。样本全部为合成数据，不是供应商实测回执。

## S2 计时契约

运行时使用 performance.now() 单调时钟；localStorage 的版本 2 快照仅保存 mode、elapsedMs、pauseReason 和 version，不保存起点。运行检查点以 paused/recovery 保存，正常离开以 paused/automatic 保存，手动暂停为 paused/manual。异常重开要求明确继续；正常自动暂停仅在页面可见、原生 active、当前会话加载完成且可操作时续计。

正常调度且保存成功时每 5 秒保存累计；保存失败显示提示，不继续承诺最多丢失 5 秒。旧 running 不补算 startedAt 至当前时刻，保留已记录累计和有限原记录备份；已膨胀累计不自动清零。提交前结算并暂停，整卷成功固化，失败按前台条件恢复；分篇提交不固化整卷。离开先结算保存，再排词汇退出任务。

自动暂停同时暂停听力，回前台不自动播放；手动休息后的明确继续保留原有音频恢复行为。原生初始状态未知时暂停；较晚返回的 getState 不覆盖更新事件。路由、加载和提交代次守卫阻止旧回调操作新会话。

依据：[Capacitor App 生命周期](https://capacitorjs.com/docs/apis/app)、[Vue Router 导航失败](https://router.vuejs.org/guide/advanced/navigation-failures.html)。浏览器验证挂载真实 PracticeView 和 ListeningPlayer，使用合成 API、可控时钟、模拟原生事件和真实 HTML audio；不能代替 Android WebView 与系统生命周期验收。

## S3 传输能力选择

已检查所安装 Capacitor 8.5 的 HTTP 类型及 Android 实现：connectTimeout/readTimeout 可用，readTimeout 是读取空闲超时；现有桥没有本任务所需的逐请求总期限与显式取消接口。JS Promise.race 只能结束业务等待，不能证明物理请求停止，因此词汇路径新增 VocabularyHttpPlugin/VocabularyHttpTransport，复用已有 OkHttp 4.12 依赖。

| 路径 | 连接等待 | 读取空闲等待 | 物理调用总期限 |
| --- | --- | --- | --- |
| FastAI 精确域名 fastaitoken.com / www.fastaitoken.com，且使用 Responses | 15 秒 | 180 秒 | 240 秒 |
| 其他词汇供应商或协议 | 15 秒 | 60 秒 | 240 秒 |
| 助手、错题及其他原有网络调用 | 沿用原默认值 | 沿用原默认值 | 沿用原桥行为 |

策略只由词汇 execution 调用传递，不根据配置名、模型名或伪造域名匹配。180 秒是候选等待策略，不是供应商成功保证。S1 的运行预算和剩余时限检查仍在发送前执行。

原生桥只接受 POST，关闭连接失败重试与重定向，并用一次性请求体阻止 OkHttp 的 HTTP follow-up 重发。一个物理槽仅在响应/连接清理后释放；桥重复调用立即拒绝。总期限覆盖读取完整响应，连续收到少量数据也不能无限延长调用。销毁时取消当前 Call。响应上限 4 MiB，只透传受限 request-id 头、HTTP 状态和 base64 正文；错误不携带 URL、Key、供应商正文或原始异常。

依据：[Capacitor HTTP](https://capacitorjs.com/docs/apis/http)、[OkHttp 4.12 OkHttpClient](https://github.com/square/okhttp/blob/parent-4.12.0/okhttp/src/main/kotlin/okhttp3/OkHttpClient.kt)、[RetryAndFollowUpInterceptor](https://github.com/square/okhttp/blob/parent-4.12.0/okhttp/src/main/kotlin/okhttp3/internal/http/RetryAndFollowUpInterceptor.kt)。

JVM 测试使用真实 OkHttp 和本机 ServerSocket，缩短超时验证：连续滴流总期限、读取空闲期限、断连不重放、400/408/503 Retry-After:0/302/307/308 各仅一次 POST、活跃槽拒绝、销毁取消及清理后下一次调用。它证明传输类的行为，不证明 Capacitor Android 运行中的完整桥交互；正常真机桥回调及系统恢复仍待验。

本地断开不保证供应商远端停止生成或计费。S1 继续保守处理 unknown，禁止自动重发；显式重试仍有重复计费可能，不承诺远端严格串行、恰好一次或费用硬上限。

## Responses 格式和脱敏样本

依据：[OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)。Responses 使用 text.format；Chat Completions 沿用 response_format。json_schema 将名称、schema 和可选 strict/description 映射到 Responses 对应字段。未知格式在发送前拒绝；HTTP 拒绝、截断或解析失败不静默降级重发。

下面仅展示协议结构，省略固定 system 提示和授权头；不是可直接使用的完整词汇生成结果。

合成主翻译请求：

```json
{
  "model": "synthetic-model",
  "input": [{
    "role": "user",
    "content": [{"type": "input_text", "text": "{\"items\":[{\"entryId\":1,\"term\":\"go\",\"sentence\":\"\"}]}"}]
  }],
  "text": {"format": {"type": "json_object"}}
}
```

合成元数据响应：

```json
{
  "status": "completed",
  "output_text": "{\"translations\":[]}",
  "usage": {
    "input_tokens": 100,
    "output_tokens": 40,
    "total_tokens": 140,
    "input_tokens_details": {"cached_tokens": 60},
    "output_tokens_details": {"reasoning_tokens": 25}
  }
}
```

HTTP 状态、受限 request-id、finish/status 和 usage 经内部封装传给 S1 审计。推理/缓存是子集，不再加到 total_tokens；缺 usage 保持未知。status=incomplete 或 finish_reason=length 等明确截断不落库为有效词汇，不补发。HTTP 参数不支持只记安全错误类别。

模型输入白名单：主翻译仅 entryId/term/sentence；补缺另含 commonMeaning。无可靠真题原句时 sentence 为空。学习次数、错误次数、复习日期、用户笔记及整行数据库字段均不进入模型输入；完整本地快照仍用于人工编辑与内容版本守卫。

FastAI 仅核对公开入口和协议映射，未调用真实端点、未验证其接受 text.format，也未测真实 180 秒请求或费用。供应商实测需明确付费验证范围。

## 后续真实路径

在获批安装目标上确认本轮版本后，验证：计时 10 分钟→退出/后台→回来继续 5 分钟累计为 15 分钟；手动暂停重开不续计；Home/锁屏/返回及横竖屏不重复累计，听力不自动播放；分篇/整卷提交成功失败符合上文；旧记录提示可见且原值保留。后台时长可用可控测试辅助，但不能把浏览器模拟结果算作真机验收。

在明确授权的供应商与合成词条范围内，再验 Responses 格式接受、慢响应/截断/缺用量、真实桥清理和未知停止；先核对 Key 与数据隔离，不向外发送私有题库来凑验证。
