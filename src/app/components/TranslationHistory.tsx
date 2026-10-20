"use client";

import { useEffect, useState, useCallback } from "react";
import { Button, Card, Empty, List, Space, Typography, message } from "antd";
import { DeleteOutlined, DownloadOutlined, HistoryOutlined } from "@ant-design/icons";
import { downloadFile } from "@/app/utils";
import {
  HISTORY_UPDATED_EVENT,
  type HistoryItem,
  deleteTranslationOutput,
  ensureSession,
  getTranslationOutputContent,
  listTranslationOutputs,
} from "@/app/lib/supabase/history";

const { Text } = Typography;

const formatDate = (iso: string) => new Date(iso).toLocaleString();

/**
 * Translations finished in this browser, kept for 7 days. No login needed.
 */
const TranslationHistory = () => {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      if (await ensureSession()) setItems(await listTranslationOutputs());
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
      }>
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
    </Card>
  );
};

export default TranslationHistory;
