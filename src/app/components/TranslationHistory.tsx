"use client";

import { useEffect, useState, useCallback } from "react";
import { Button, Card, Empty, Input, List, Space, Typography, message } from "antd";
import { DeleteOutlined, DownloadOutlined, HistoryOutlined, LogoutOutlined } from "@ant-design/icons";
import type { User } from "@supabase/supabase-js";
import { downloadFile } from "@/app/utils";
import {
  HISTORY_UPDATED_EVENT,
  type HistoryItem,
  deleteTranslationOutput,
  getCurrentUser,
  getTranslationOutputContent,
  listTranslationOutputs,
  onUserChange,
  sendMagicLink,
  signOut,
} from "@/app/lib/supabase/history";

const { Text } = Typography;

const formatDate = (iso: string) => new Date(iso).toLocaleString();

/**
 * Login + 7-day translation history. Shows a sign-in form when signed out.
 * Signed in: lists saved outputs with download and delete.
 */
const TranslationHistory = () => {
  const [user, setUser] = useState<User | null>(null);
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
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
    let active = true;
    getCurrentUser().then((u) => {
      if (!active) return;
      setUser(u);
      if (u) refresh();
    });
    const unsubscribe = onUserChange((u) => {
      setUser(u);
      if (u) refresh();
      else setItems([]);
    });
    const onSaved = () => refresh();
    window.addEventListener(HISTORY_UPDATED_EVENT, onSaved);
    return () => {
      active = false;
      unsubscribe();
      window.removeEventListener(HISTORY_UPDATED_EVENT, onSaved);
    };
  }, [refresh]);

  const handleSendLink = async () => {
    const value = email.trim();
    if (!value) return;
    setSending(true);
    try {
      await sendMagicLink(value);
      setSent(true);
      message.success("Login link sent. Open it from this browser.");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "Could not send login link");
    } finally {
      setSending(false);
    }
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
        user ? (
          <Button size="small" icon={<LogoutOutlined />} onClick={() => signOut()}>
            Sign out
          </Button>
        ) : null
      }>
      {!user ? (
        <Space direction="vertical" style={{ width: "100%" }}>
          <Text type="secondary">Sign in with your email to keep translated files for 7 days and open them on any device.</Text>
          <Space.Compact style={{ width: "100%" }}>
            <Input type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} onPressEnter={handleSendLink} disabled={sending} />
            <Button type="primary" onClick={handleSendLink} loading={sending} disabled={!email.trim()}>
              {sent ? "Resend link" : "Send login link"}
            </Button>
          </Space.Compact>
        </Space>
      ) : (
        <List
          loading={loading}
          locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No saved translations yet" /> }}
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
      )}
    </Card>
  );
};

export default TranslationHistory;
