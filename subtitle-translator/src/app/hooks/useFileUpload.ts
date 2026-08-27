"use client";
import { useState, useRef } from "react";
import { App } from "antd";
import { useTranslations } from "next-intl";
import { normalizeNewlines, decodeFileBytes, getErrorMessage } from "@/app/utils";
import type { UploadFile, UploadProps } from "antd";

// Shared dedup predicate: match by name + size
const isDuplicateFile = (a: { name: string; size?: number }, b: { name: string; size?: number }): boolean => a.name === b.name && a.size === b.size;

const useFileUpload = () => {
  const { message } = App.useApp();
  const t = useTranslations("common");
  const [sourceText, setSourceText] = useState<string>("");
  const [multipleFiles, setMultipleFiles] = useState<File[]>([]);
  // uploadMode 是 multipleFiles.length 的纯派生值,不再单独 setState —— 之前
  // 把它存成独立 state,靠三处(handleFileUpload / handleUploadRemove /
  // handleUploadChange)各自在合适时机 setUploadMode 来同步,一次选多个文件时
  // React 把同一批 setState 批处理成一次渲染,这些地方读到的都是【批处理开始前】
  // 的旧值,互相打架,导致 5 个文件选完只剩最后 1 个生效。派生值没有"该在哪个
  // 时机同步"这个问题,读到的永远是当下的真实文件数。
  const uploadMode: "single" | "multiple" = multipleFiles.length > 1 ? "multiple" : "single";
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  // multipleFiles 的镜像,但是 ref —— 不经过 React 的批处理。一次选多个文件时,
  // 浏览器对每个文件各触发一次 customRequest,这些调用都发生在【同一个】原生
  // change 事件里、React 还没来得及把前几次 setState 提交成新的一次渲染,所以
  // 如果靠 state(哪怕是函数式更新的闭包参数 prevFiles)去判断"这是第几个文件"
  // 或"现在总共有几个",读到的都可能是这批操作开始前的旧快照。ref 赋值是同步的、
  // 立即生效,同一批里第 2、3...个文件的处理都能看到前面刚追加的结果,可以在
  // 事件处理函数里就地做出"该不该现在就读文件内容进 sourceText"的正确判断,
  // 不需要额外借助 useEffect(经 React Compiler 检查会因"在 effect 里同步
  // setState"报错,详见下方 startReadIfSingle 的注释)。
  const filesRef = useRef<File[]>([]);
  const [singleFileMode, setSingleFileMode] = useState(false);
  const [isFileProcessing, setIsFileProcessing] = useState<boolean>(false);
  // 读取序号守卫:FileReader.onload / decodeFileBytes 都是异步,一次读取尚未完成时
  // 又发起新读取(连续换文件)或清空(resetUpload),旧读的回调若晚到会用旧内容
  // 覆盖新状态 —— 用户看到的正文与文件列表不符,或清空后内容又冒回来。每次读取/
  // 清空自增序号,过期(seq 不再是最新)的 onload 结果直接丢弃(同 text-diff loadSeq)。
  const loadSeq = useRef(0);

  // readFile 不做序号守卫:批量消费者(chinese-conversion 用 Promise.all 并发读多文件、
  // 各自独立回调)需要【每个】回调都触发,守卫会把先发起的读丢弃 → 其 resolve 永不
  // 调用 → Promise.all 永久挂起。序号守卫只加在写【共享】sourceText 的那条路径上
  // (单文件上传 / 删到只剩一个),见 latestSourceWriter 包装。
  // onError lets batch callers settle their per-file Promise when decode/read fails.
  // Without it the success `callback` (which usually calls resolve()) never runs, so a
  // single bad file hangs the whole batch loop forever.
  const readFile = (file: File, callback: (text: string) => void, onError?: () => void) => {
    setIsFileProcessing(true);
    const reader = new FileReader();

    reader.onload = async (e) => {
      try {
        const buffer = e.target?.result as ArrayBuffer;
        // 编码自适应解码(UTF-8 fatal 试解 → jschardet 检测)抽到共享的
        // decodeFileBytes —— 词汇表/保护规则导入同此管线,策略说明见 fileUtils。
        const text = await decodeFileBytes(buffer);
        callback(normalizeNewlines(text));
      } catch (error) {
        // jschardet 加载失败 / 解码异常等：别让 onload 静默 reject（否则下方 finally 之外
        // 的 setIsFileProcessing(false) 永远不执行，处理中遮罩会一直转）。
        console.error("处理文件出错：", error);
        // 【带上原始消息】。decodeFileBytes 在判不出编码时抛的是一句可操作的
        // 指引("unrecognized text encoding — re-save the file as UTF-8"),
        // 而通用的 fileProcessFailed 把它整个吞掉:中文 Windows 上 Excel/记事本
        // 存出的短 GBK 字幕会被 jschardet 误判成 IBM855 之类(实测),用户只看到
        // 「文件处理失败」,而三个翻译工具都没有手动选编码的入口 —— 等于无路可走。
        // getErrorMessage 而非手写 instanceof:后者对【非 Error 抛出】(字符串、
        // 对象)返回空串,又退回成裸的「文件处理失败」—— 正是这段改动要消除的。
        message.warning(`${t("fileProcessFailed")}: ${getErrorMessage(error)}`);
        onError?.();
      } finally {
        setIsFileProcessing(false);
      }
    };

    reader.onerror = (error) => {
      console.error("读取文件出错：", error);
      message.error(t("fileReadFailed"));
      onError?.();
      setIsFileProcessing(false);
    };
    reader.readAsArrayBuffer(file);
  };

  // 把「写入共享 sourceText」的回调用当前读取序号封一层:换文件 / 清空会自增序号,
  // 较早读取的过期 onload 写回时序号已变 → 丢弃,不覆盖新文件内容或清空后的空态。
  // 批量读取各自独立,不经此路径,故不受影响。
  const latestSourceWriter = () => {
    const seq = ++loadSeq.current;
    return (text: string) => {
      if (seq === loadSeq.current) setSourceText(text);
    };
  };

  const resetUpload = () => {
    loadSeq.current++; // 取消所有在途读取:清空后过期 onload 不得把内容写回来
    filesRef.current = [];
    setFileList([]);
    setMultipleFiles([]);
    setSourceText("");
    // uploadMode 现在是派生值,multipleFiles 清空后自动回到 "single",无需再手动设。
  };

  const handleUploadChange: UploadProps["onChange"] = ({ fileList }: { fileList: UploadFile[] }) => {
    const updatedFileList: UploadFile[] = fileList.map((f) => ({
      uid: f.uid,
      name: f.name,
      status: "done",
      size: f.size,
      originFileObj: f.originFileObj,
    }));

    const uniqueFileList = updatedFileList.filter((value, index, self) => index === self.findIndex((t) => isDuplicateFile(t, value)));
    setFileList(uniqueFileList);

    // 单/多模式切换已经交给 uploadMode 的派生值 + handleFileUpload/handleUploadRemove
    // 里对 filesRef 的同步更新处理(见上方),这里不再重复判断 —— 原先这里读
    // uploadMode 跟 handleFileUpload 里那份是同一个批处理陷阱,两处各判一次反而
    // 更容易前后矛盾。这里只保留"清空到 0 个文件"这一支,因为它不涉及模式判断,
    // 直接重置即可。
    if (uniqueFileList.length === 0) {
      resetUpload();
    }
  };

  // 数组最终恰好剩 1 个文件时(无论是新上传只有它一个,还是从多个删到只剩它),
  // 把它的内容读进 sourceText 供单文件模式的 SourceArea 显示/编辑;超过 1 个
  // 文件时 uploadMode 派生为 "multiple",SourceArea 不渲染,不需要读进 sourceText
  // (handleMultipleTranslate 会在真正翻译时各自读取每个文件)。
  const startReadIfSingle = (files: File[]) => {
    if (files.length === 1) readFile(files[0], latestSourceWriter());
  };

  // 一次选多个文件时,浏览器对每个文件各触发一次 customRequest,但 React 18/19
  // 会把同一个原生 change 事件里的所有 setState 批处理成一次渲染 —— 也就是说
  // 处理第 2、3...个文件时,若靠 state(哪怕是函数式更新里的 prevFiles 参数)
  // 判断"现在总共有几个文件",读到的可能仍是这批操作开始前的旧快照。
  // filesRef 的赋值是同步、立即生效的,不受 React 批处理影响,所以这里既用它
  // 追加/去重,又直接拿它算出的最终长度决定要不要现在就读文件内容 —— 全部在
  // 这一次事件处理函数调用里就地完成,批内每个文件各自都能看到前面刚追加的
  // 结果,不会互相用旧值覆盖。
  const handleFileUpload = (uploadedFile: File) => {
    if (filesRef.current.some((f) => isDuplicateFile(f, uploadedFile))) return false;

    const updatedFiles = [...filesRef.current, uploadedFile];
    filesRef.current = updatedFiles;
    setMultipleFiles(updatedFiles);
    startReadIfSingle(updatedFiles);

    // antd Upload uses `false` return to suppress its default XHR upload —
    // we just collect the file into state and process locally.
    return false;
  };

  const handleUploadRemove: UploadProps["onRemove"] = (file: UploadFile) => {
    const updatedFileList = fileList.filter((f) => f.uid !== file.uid);
    setFileList(updatedFileList);

    const updatedFiles = filesRef.current.filter((f) => !isDuplicateFile(f, file));
    filesRef.current = updatedFiles;
    setMultipleFiles(updatedFiles);
    // 降到 1 个文件时,把它的内容读进 sourceText,切回单文件模式的显示。
    startReadIfSingle(updatedFiles);
  };

  return {
    isFileProcessing,
    fileList,
    multipleFiles,
    readFile,
    sourceText,
    setSourceText,
    uploadMode,
    singleFileMode,
    setSingleFileMode,
    handleFileUpload,
    handleUploadRemove,
    handleUploadChange,
    resetUpload,
  };
};

export default useFileUpload;
