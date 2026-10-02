import type { ReactNode } from "react";
import { MdChecklist, MdCode, MdEmojiEmotions, MdGesture, MdNotes, MdOutlineDraw, MdPoll } from "react-icons/md";
import type { ToolKind } from "@/lib/roomTools";

export const TOOL_ICONS: Record<ToolKind, ReactNode> = {
  whiteboard: <MdOutlineDraw />,
  notepad: <MdNotes />,
  annotate: <MdGesture />,
  poll: <MdPoll />,
  reactions: <MdEmojiEmotions />,
  code: <MdCode />,
  tasks: <MdChecklist />,
};
