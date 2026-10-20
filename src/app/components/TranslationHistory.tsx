"use client";

import { useEffect, useState, useCallback } from "react";
import { App, Button, Card, Empty, Input, List, Space, Tag, Typography } from "antd";
import { CaretRightOutlined, DeleteOutlined, DownloadOutlined, HistoryOutlined, LogoutOutlined, MailOutlined } from "@ant-design/icons";
import {
  HISTORY_UPDATED_EVENT,
  type AccountState,
  type HistoryItem,
  type SavedFile,
  deleteHistoryItem,
  downloadHistoryItem,
  getAccountState,
  listHistory,
  loadJobFiles,
  onUserChange,
  sendEmailLogin,
  signOutAccount,
} from "@/app/lib/supabase/history";

const { Text } = Typography;

const formatDate = (iso: string) => new Date(iso).toLocaleString();

type Props = {
  /** Continue a paused job: receives its original files. */
  onContinue?: (files: SavedFile[]) => void;
};

/**
 * History box. Signed out: email login form. Signed in: finished files, batch zips,
 * and paused jobs that can be continued (7 days).
 */
const TranslationHistory = ({ onContinue }: Props) => {
  const { modal, message } = App.useApp();
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
      setItems(await listHistory());
    } catch (error) {
      message.error(error instanceof Error ? error.message : "Could not load history");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const unsubscribe = onUserChange(() => refresh());
    window.addEventListener(HISTORY_UPDATED_EVENT, refresh);
    return () => {
      unsubscribe();
      window.removeEventListener(HISTORY_UPDATED_EVENT, refresh);
    };
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
      await downloadHistoryItem(item);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "Download failed");
    }
  };

  const handleContinue = async (item: HistoryItem) => {
    if (!onContinue) return;
    try {
      const files = await loadJobFiles(item.id);
      onContinue(files);
      message.success("Files loaded. Click Translate to continue; finished lines are reused from cache.");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "Could not load the paused job");
    }
  };

  const performDelete = async (item: HistoryItem) => {
    try {
      await deleteHistoryItem(item);
      setItems((prev) => prev.filter((i) => !(i.id === item.id && i.type === item.type)));
      message.success("Deleted");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "Delete failed");
    }
  };

  // Ask first, in a centered dialog, so a click never removes a saved file by accident.
  const handleDelete = (item: HistoryItem) => {
    modal.confirm({
      title: "Delete this item?",
      content: `"${item.title}" will be removed from your history. This cannot be undone.`,
      okText: "Delete",
      okType: "danger",
      cancelText: "Cancel",
      centered: true,
      onOk: () => performDelete(item),
    });
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
            renderItem={(item) => {
              const isJob = item.type === "job";
              const actions = isJob
                ? [
                    <Button key="cont" type="primary" size="small" icon={<CaretRightOutlined />} onClick={() => handleContinue(item)}>
                      Continue
                    </Button>,
                    <Button key="del" size="small" danger icon={<DeleteOutlined />} onClick={() => handleDelete(item)} />,
                  ]
                : [
                    <Button key="dl" size="small" icon={<DownloadOutlined />} onClick={() => handleDownload(item)}>
                      {item.type === "zip" ? `Download ZIP (${item.file_count})` : "Download"}
                    </Button>,
                    <Button key="del" size="small" danger icon={<DeleteOutlined />} onClick={() => handleDelete(item)} />,
                  ];
              return (
                <List.Item actions={actions}>
                  <List.Item.Meta
                    title={
                      <Space size={6}>
                        {isJob ? <Tag color="orange">Paused</Tag> : item.type === "zip" ? <Tag color="blue">ZIP</Tag> : null}
                        {item.title}
                      </Space>
                    }
                    description={`${item.target_lang ? item.target_lang + " · " : ""}${isJob ? `${item.file_count} file(s) · ` : ""}${formatDate(item.created_at)} · expires ${formatDate(item.expires_at)}`}
                  />
                </List.Item>
              );
            }}
          />
        </>
      )}
    </Card>
  );
};

export default TranslationHistory;
