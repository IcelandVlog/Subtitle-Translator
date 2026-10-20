"use client";

import { useEffect, useState, useCallback } from "react";
import { Button, Card, Empty, Input, List, Space, Typography, message } from "antd";
import { DeleteOutlined, DownloadOutlined, HistoryOutlined, LogoutOutlined, MailOutlined } from "@ant-design/icons";
import { downloadFile } from "@/app/utils";
import {
  HISTORY_UPDATED_EVENT,
  type AccountState,
  type HistoryItem,
  deleteTranslationOutput,
  getAccountState,
  getTranslationOutputContent,
  listTranslationOutputs,
  sendEmailLogin,
  signOutAccount,
} from "@/app/lib/supabase/history";

const { Text } = Typography;

const formatDate = (iso: string) => new Date(iso).toLocaleString();

/**
 * Translation history box. Signed out: email login form. Signed in: the saved list (7 days).
 * Outputs are saved even without login; they show up here after signing in.
 */
const TranslationHistory = () => {
  const [account, setAccount] = useState<AccountState>({ signedIn: false, email: null, isAnonymous: true });
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);

  const refresh = useCallback(async () => {
    const state = await getAccountState();
    setAccount(state);
    if (!state.signedIn) {
      setItems([]);
      return;
    }
    setLoading(true);
    try {
      setItems(await listTranslationOutputs());
    } catch (error) {
      message.error(error instanceof Error ? error.message : "Could not load history");
    } finally {
      setLoading(false);
    }
  }, []);

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

  const handleDownload = async (item: HistoryItem) => {
    try {
      const content = await getTranslationOutputContent(item.id);
      await downloadFile(content, item.file_name);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "Download failed");
    }
  };

  const handleDelete = async (item: HistoryItem) => {
    try {
      await deleteTranslationOutput(item.id);
      setItems((prev) => prev.filter((i) => i.id !== item.id));
    } catch (error) {
      message.error(error instanceof Error ? error.message : "Delete failed");
    }
  };

  return (
    <Card
      size="small"
      style={{ marginBottom: 16 }}
      title={
        <Space>
          <HistoryOutlined /> Translation history (kept 7 days)
        </Space>
      }
      extra={
        account.signedIn ? (
          <Button size="small" icon={<LogoutOutlined />} onClick={handleSignOut}>
            Sign out
          </Button>
        ) : null
      }>
      {!account.signedIn ? (
        <Space direction="vertical" style={{ width: "100%" }}>
          <Text type="secondary">Sign in with your email to see your translation history here, and to open it on any device.</Text>
          <Space.Compact style={{ width: "100%" }}>
            <Input prefix={<MailOutlined />} type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} onPressEnter={handleSend} disabled={sending} />
            <Button type="primary" onClick={handleSend} loading={sending} disabled={!email.trim()}>
              Send login link
            </Button>
          </Space.Compact>
        </Space>
      ) : (
        <>
          <Text type="secondary" style={{ display: "block", marginBottom: 8 }}>
            Signed in as {account.email}
          </Text>
          <List
            loading={loading}
            locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={<Text type="secondary">No saved translations yet</Text>} /> }}
            dataSource={items}
            renderItem={(item) => (
              <List.Item
                actions={[
                  <Button key="dl" size="small" icon={<DownloadOutlined />} onClick={() => handleDownload(item)}>
                    Download
                  </Button>,
                  <Button key="del" size="small" danger icon={<DeleteOutlined />} onClick={() => handleDelete(item)} />,
                ]}>
                <List.Item.Meta
                  title={item.file_name}
                  description={`${item.target_lang ? item.target_lang + " · " : ""}${formatDate(item.created_at)} · expires ${formatDate(item.expires_at)}`}
                />
              </List.Item>
            )}
          />
        </>
      )}
    </Card>
  );
};

export default TranslationHistory;
