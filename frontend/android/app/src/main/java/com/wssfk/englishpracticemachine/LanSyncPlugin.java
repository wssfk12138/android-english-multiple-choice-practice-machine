package com.wssfk.englishpracticemachine;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONObject;

@CapacitorPlugin(name = "LanSync")
public class LanSyncPlugin extends Plugin {
    private LanDiscovery discovery;
    private boolean destroyed;
    private final LanNetworkExecutor network = new LanNetworkExecutor();

    private void executeNetwork(PluginCall call, Runnable operation) {
        if (!network.submit(operation)) {
            call.reject("局域网同步已停止", "LAN_NETWORK_ERROR");
        }
    }

    @PluginMethod
    public void discover(PluginCall call) {
        executeNetwork(call, () -> {
            LanDiscovery search = null;
            try {
                search = new LanDiscovery((android.net.nsd.NsdManager) getContext()
                        .getSystemService(android.content.Context.NSD_SERVICE), call.getString("hostId", ""));
                synchronized (this) {
                    if (destroyed || discovery != null) {
                        call.reject("局域网发现已停止或正在进行", "LAN_NETWORK_ERROR");
                        return;
                    }
                    discovery = search;
                }
                JSObject result = new JSObject();
                result.put("urls", new org.json.JSONArray(search.find()));
                call.resolve(result);
            } catch (Exception e) {
                call.reject("局域网发现不可用，请检查网络或重新扫码", "LAN_NETWORK_ERROR");
            } finally {
                if (search != null) search.close();
                synchronized (this) {
                    if (discovery == search) discovery = null;
                }
            }
        });
    }

    @Override protected void handleOnDestroy() {
        LanDiscovery search;
        synchronized (this) {
            destroyed = true;
            search = discovery;
            discovery = null;
        }
        if (search != null) search.close();
        network.close();
        super.handleOnDestroy();
    }

    @PluginMethod
    public void post(PluginCall call) {
        executeNetwork(call, () -> {
            try {
                String url = call.getString("url", "");
                JSObject data = call.getObject("data");
                if (data == null) { call.reject("LAN request must be an object", "LAN_REQUEST_INVALID"); return; }
                LanTlsTrust trust = null;
                if (call.getData().has("tls")) {
                    JSObject tls = call.getObject("tls");
                    if (tls == null) throw new IllegalArgumentException("Missing TLS identity");
                    trust = new LanTlsTrust(tls.optString("hostId"),
                            tls.optString("certificatePem"), tls.optString("certificatePin"));
                }
                LanSyncTransport.Result result = LanSyncTransport.post(url, data.toString(), trust);
                JSObject response = new JSObject();
                response.put("status", result.status);
                // Error bodies are not needed for authentication/status handling and may contain secrets.
                response.put("data", result.status == 200 ? new JSONObject(result.data) : new JSObject());
                call.resolve(response);
            } catch (IllegalArgumentException e) {
                call.reject("LAN HTTP 地址必须为私网 IPv4，且仅允许同步端点", "LAN_REQUEST_INVALID");
            } catch (javax.net.ssl.SSLException | java.security.GeneralSecurityException e) {
                call.reject("电脑身份或证书校验失败，请重新核对配对信息", "LAN_TLS_IDENTITY_ERROR");
            } catch (org.json.JSONException e) {
                call.reject("电脑端同步响应不是有效 JSON 对象", "LAN_RESPONSE_INVALID");
            } catch (java.net.SocketTimeoutException e) {
                call.reject("电脑端同步请求超时", "LAN_TIMEOUT");
            } catch (Exception e) {
                call.reject("无法连接电脑端同步服务，请检查地址、服务与网络；不支持重定向", "LAN_NETWORK_ERROR");
            }
        });
    }
}
