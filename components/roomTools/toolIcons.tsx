import type { ReactNode } from "react";
import {
  MdChecklist,
  MdCode,
  MdDescription,
  MdEmojiEmotions,
  MdGesture,
  MdNotes,
  MdOutlineDraw,
  MdPoll,
  MdTableChart,
} from "react-icons/md";
import type { ToolKind } from "@/lib/roomTools";

export const TOOL_ICONS: Record<ToolKind, ReactNode> = {
  whiteboard: <MdOutlineDraw />,
  notepad: <MdNotes />,
  annotate: <MdGesture />,
  poll: <MdPoll />,
  reactions: <MdEmojiEmotions />,
  code: <MdCode />,
  tasks: <MdChecklist />,
  sheet: <MdTableChart />,
  doc: <MdDescription />,
};
