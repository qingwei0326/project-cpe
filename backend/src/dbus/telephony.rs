//! 自 dbus.rs 拆出（纯移动，逻辑未改）。

use super::*;

/// 获取当前活动的通话列表
pub async fn get_active_calls(conn: &Connection) -> zbus::Result<Vec<CallInfo>> {
    with_serial(async {
        let proxy = VoiceCallManagerProxy::new(conn).await?;
        let calls = proxy.get_calls().await?;

        let mut result = Vec::new();
        for (path, props) in calls {
            let phone_number = props
                .get("LineIdentification")
                .and_then(|v| String::try_from(v.clone()).ok())
                .unwrap_or_else(|| "Unknown".to_string());

            let state = props
                .get("State")
                .and_then(|v| String::try_from(v.clone()).ok())
                .unwrap_or_else(|| "unknown".to_string());

            let start_time = props
                .get("StartTime")
                .and_then(|v| String::try_from(v.clone()).ok());

            // 判断方向：incoming 或 outgoing
            let direction = if state == "incoming" {
                "incoming".to_string()
            } else {
                "outgoing".to_string()
            };

            result.push(CallInfo {
                path: path.to_string(),
                phone_number,
                state,
                direction,
                start_time,
            });
        }

        Ok(result)
    })
    .await
}

/// 拨打电话
pub async fn dial_call(conn: &Connection, phone_number: &str) -> zbus::Result<CallInfo> {
    with_serial(async {
        let proxy = VoiceCallManagerProxy::new(conn).await?;
        let path = proxy.dial(phone_number, "default").await?;

        Ok(CallInfo {
            path: path.to_string(),
            phone_number: phone_number.to_string(),
            state: "dialing".to_string(),
            direction: "outgoing".to_string(),
            start_time: Some(chrono::Utc::now().to_rfc3339()),
        })
    })
    .await
}

/// 挂断指定通话
pub async fn hangup_call(conn: &Connection, call_path: &str) -> zbus::Result<()> {
    with_serial(async {
        let proxy = VoiceCallProxy::builder(conn)
            .path(call_path)?
            .build()
            .await?;

        proxy.hangup().await
    })
    .await
}

/// 挂断所有通话
pub async fn hangup_all_calls(conn: &Connection) -> zbus::Result<usize> {
    with_serial(async {
        let proxy = VoiceCallManagerProxy::new(conn).await?;
        let calls = proxy.get_calls().await?;
        let count = calls.len();

        if count > 0 {
            proxy.hangup_all().await?;
        }

        Ok(count)
    })
    .await
}

/// 接听来电
pub async fn answer_call(conn: &Connection, call_path: &str) -> zbus::Result<()> {
    with_serial(async {
        let proxy = VoiceCallProxy::builder(conn)
            .path(call_path)?
            .build()
            .await?;

        proxy.answer().await
    })
    .await
}

// ============ 短信相关 D-Bus 接口 ============

/// 发送短信
pub async fn send_sms(
    conn: &Connection,
    phone_number: &str,
    content: &str,
) -> zbus::Result<String> {
    with_serial(async {
        let proxy = Proxy::new(conn, "org.ofono", "/ril_0", "org.ofono.MessageManager").await?;
        let message_path: zbus::zvariant::OwnedObjectPath =
            proxy.call("SendMessage", &(phone_number, content)).await?;
        Ok(message_path.to_string())
    })
    .await
}

/// 获取通话音量
pub async fn get_call_volume(conn: &Connection) -> zbus::Result<CallVolumeResponse> {
    with_serial(async {
        let proxy = Proxy::new(conn, "org.ofono", "/ril_0", "org.ofono.CallVolume").await?;
        let props: HashMap<String, OwnedValue> = proxy.call("GetProperties", &()).await?;

        let speaker_volume = props
            .get("SpeakerVolume")
            .and_then(|v| u8::try_from(v.clone()).ok())
            .unwrap_or(0);

        let microphone_volume = props
            .get("MicrophoneVolume")
            .and_then(|v| u8::try_from(v.clone()).ok())
            .unwrap_or(0);

        let muted = props
            .get("Muted")
            .and_then(|v| bool::try_from(v.clone()).ok())
            .unwrap_or(false);

        Ok(CallVolumeResponse {
            speaker_volume,
            microphone_volume,
            muted,
        })
    })
    .await
}

/// 设置通话音量
pub async fn set_call_volume(
    conn: &Connection,
    speaker: Option<u8>,
    microphone: Option<u8>,
    muted: Option<bool>,
) -> zbus::Result<()> {
    with_serial(async {
        let proxy = Proxy::new(conn, "org.ofono", "/ril_0", "org.ofono.CallVolume").await?;

        if let Some(vol) = speaker {
            let val = zbus::zvariant::Value::new(vol);
            proxy
                .call::<_, _, ()>("SetProperty", &("SpeakerVolume", val))
                .await?;
        }

        if let Some(vol) = microphone {
            let val = zbus::zvariant::Value::new(vol);
            proxy
                .call::<_, _, ()>("SetProperty", &("MicrophoneVolume", val))
                .await?;
        }

        if let Some(m) = muted {
            let val = zbus::zvariant::Value::new(m);
            proxy
                .call::<_, _, ()>("SetProperty", &("Muted", val))
                .await?;
        }

        Ok(())
    })
    .await
}

/// 获取语音留言状态
pub async fn get_voicemail_status(conn: &Connection) -> zbus::Result<VoicemailStatusResponse> {
    with_serial(async {
        let proxy = Proxy::new(conn, "org.ofono", "/ril_0", "org.ofono.MessageWaiting").await?;
        let props: HashMap<String, OwnedValue> = proxy.call("GetProperties", &()).await?;

        let waiting = props
            .get("VoicemailWaiting")
            .and_then(|v| bool::try_from(v.clone()).ok())
            .unwrap_or(false);

        let message_count = props
            .get("VoicemailMessageCount")
            .and_then(|v| u8::try_from(v.clone()).ok())
            .unwrap_or(0);

        let mailbox_number = props
            .get("VoicemailMailboxNumber")
            .and_then(|v| String::try_from(v.clone()).ok())
            .unwrap_or_default();

        Ok(VoicemailStatusResponse {
            waiting,
            message_count,
            mailbox_number,
        })
    })
    .await
}

/// 获取呼叫转移设置
pub async fn get_call_forwarding(conn: &Connection) -> zbus::Result<CallForwardingResponse> {
    with_serial(async {
        let proxy = Proxy::new(conn, "org.ofono", "/ril_0", "org.ofono.CallForwarding").await?;
        let props: HashMap<String, OwnedValue> = proxy.call("GetProperties", &()).await?;

        let voice_unconditional = props
            .get("VoiceUnconditional")
            .and_then(|v| String::try_from(v.clone()).ok())
            .unwrap_or_default();

        let voice_busy = props
            .get("VoiceBusy")
            .and_then(|v| String::try_from(v.clone()).ok())
            .unwrap_or_default();

        let voice_no_reply = props
            .get("VoiceNoReply")
            .and_then(|v| String::try_from(v.clone()).ok())
            .unwrap_or_default();

        let voice_no_reply_timeout = props
            .get("VoiceNoReplyTimeout")
            .and_then(|v| u16::try_from(v.clone()).ok())
            .unwrap_or(20);

        let voice_not_reachable = props
            .get("VoiceNotReachable")
            .and_then(|v| String::try_from(v.clone()).ok())
            .unwrap_or_default();

        let forwarding_flag_on_sim = props
            .get("ForwardingFlagOnSim")
            .and_then(|v| bool::try_from(v.clone()).ok())
            .unwrap_or(false);

        Ok(CallForwardingResponse {
            voice_unconditional,
            voice_busy,
            voice_no_reply,
            voice_no_reply_timeout,
            voice_not_reachable,
            forwarding_flag_on_sim,
        })
    })
    .await
}

/// 设置呼叫转移
pub async fn set_call_forwarding(
    conn: &Connection,
    forward_type: &str,
    number: &str,
    timeout: Option<u16>,
) -> zbus::Result<()> {
    with_serial(async {
        let proxy = Proxy::new(conn, "org.ofono", "/ril_0", "org.ofono.CallForwarding").await?;

        let property_name = match forward_type {
            "unconditional" => "VoiceUnconditional",
            "busy" => "VoiceBusy",
            "noreply" => "VoiceNoReply",
            "notreachable" => "VoiceNotReachable",
            _ => return Err(zbus::Error::Failure("Invalid forward type".to_string())),
        };

        let number_value = zbus::zvariant::Value::new(number);
        proxy
            .call::<_, _, ()>("SetProperty", &(property_name, number_value))
            .await?;

        // 如果是 noreply 类型且提供了超时时间
        if forward_type == "noreply" {
            if let Some(timeout) = timeout {
                let timeout_value = zbus::zvariant::Value::new(timeout);
                proxy
                    .call::<_, _, ()>("SetProperty", &("VoiceNoReplyTimeout", timeout_value))
                    .await?;
            }
        }

        Ok(())
    })
    .await
}

/// 获取通话设置
pub async fn get_call_settings(conn: &Connection) -> zbus::Result<CallSettingsResponse> {
    with_serial(async {
        let proxy = Proxy::new(conn, "org.ofono", "/ril_0", "org.ofono.CallSettings").await?;
        let props: HashMap<String, OwnedValue> = proxy.call("GetProperties", &()).await?;

        let calling_line_presentation = props
            .get("CallingLinePresentation")
            .and_then(|v| String::try_from(v.clone()).ok())
            .unwrap_or_else(|| "unknown".to_string());

        let calling_name_presentation = props
            .get("CallingNamePresentation")
            .and_then(|v| String::try_from(v.clone()).ok())
            .unwrap_or_else(|| "unknown".to_string());

        let connected_line_presentation = props
            .get("ConnectedLinePresentation")
            .and_then(|v| String::try_from(v.clone()).ok())
            .unwrap_or_else(|| "unknown".to_string());

        let connected_line_restriction = props
            .get("ConnectedLineRestriction")
            .and_then(|v| String::try_from(v.clone()).ok())
            .unwrap_or_else(|| "unknown".to_string());

        let called_line_presentation = props
            .get("CalledLinePresentation")
            .and_then(|v| String::try_from(v.clone()).ok())
            .unwrap_or_else(|| "unknown".to_string());

        let calling_line_restriction = props
            .get("CallingLineRestriction")
            .and_then(|v| String::try_from(v.clone()).ok())
            .unwrap_or_else(|| "unknown".to_string());

        let hide_caller_id = props
            .get("HideCallerId")
            .and_then(|v| String::try_from(v.clone()).ok())
            .unwrap_or_else(|| "default".to_string());

        let voice_call_waiting = props
            .get("VoiceCallWaiting")
            .and_then(|v| String::try_from(v.clone()).ok())
            .unwrap_or_else(|| "unknown".to_string());

        Ok(CallSettingsResponse {
            calling_line_presentation,
            calling_name_presentation,
            connected_line_presentation,
            connected_line_restriction,
            called_line_presentation,
            calling_line_restriction,
            hide_caller_id,
            voice_call_waiting,
        })
    })
    .await
}

/// 设置通话设置
pub async fn set_call_setting(conn: &Connection, property: &str, value: &str) -> zbus::Result<()> {
    with_serial(async {
        let proxy = Proxy::new(conn, "org.ofono", "/ril_0", "org.ofono.CallSettings").await?;
        let value_variant = zbus::zvariant::Value::new(value);
        proxy.call("SetProperty", &(property, value_variant)).await
    })
    .await
}
