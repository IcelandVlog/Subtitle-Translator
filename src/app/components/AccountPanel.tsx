"use client";

import { useEffect, useState, useCallback } from "react";
import { Button, Card, Input, Space, Typography, message } from "antd";
import { LoginOutlined, LogoutOutlined, MailOutlined } from "@ant-design/icons";
import { HISTORY_UPDATED_EVENT, type AccountState, getAccountState, sendEmailLogin, signOutAccount } from "@/app/lib/supabase/history";

const { Text } = Typography;

/**
 * Email login at the bottom of the page. Keeps the translation history on every device.
 * Not signed in = history still saved in this browser (anonymous session).
 */
const AccountPanel = () => {
  const [state, setState] = useState<AccountState>({ signedIn: false, email: null, isAnonymous: true });
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);

  const refresh = useCallback(async () => setState(await getAccountState()), []);

  useEffect(() => {
    refresh();
    window.addEventListener(HISTORY_UPDATED_EVENT, refresh);
    return () => window.removeEventListener(HISTORY_UPDATED_EVENT, refresh);
  }, [refresh]);

  const handleSend = async () => {
    const value = email.trim();
    if (!value) return;
    setSending(true);
    try {
      await sendEmailLogin(value);
      message.success("Login link sent to your email. Open it in this browser.");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "Could not send login link");
    } finally {
      setSending(false);
    }
  };

  const handleSignOut = async () => {
    await signOutAccount();
    setEmail("");
    refresh();
  };

  return (
    <Card size="small" style={{ marginTop: 24 }} title={<Space><LoginOutlined /> Account</Space>}>
      {state.signedIn ? (
        <Space style={{ width: "100%", justifyContent: "space-between" }} wrap>
          <Text>Signed in as <Text strong>{state.email}</Text>. Your history is available on every device.</Text>
          <Button size="small" icon={<LogoutOutlined />} onClick={handleSignOut}>
            Sign out
          </Button>
        </Space>
      ) : (
        <Space direction="vertical" style={{ width: "100%" }}>
          <Text type="secondary">
            Sign in with your email to open your translation history on any device. Without signing in, history is kept only in this browser.
          </Text>
          <Space.Compact style={{ width: "100%" }}>
            <Input prefix={<MailOutlined />} type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} onPressEnter={handleSend} disabled={sending} />
            <Button type="primary" onClick={handleSend} loading={sending} disabled={!email.trim()}>
              Send login link
            </Button>
          </Space.Compact>
        </Space>
      )}
    </Card>
  );
};

export default AccountPanel;
