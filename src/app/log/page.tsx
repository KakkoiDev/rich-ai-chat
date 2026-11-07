import type { Metadata } from "next";
import { ActivityLog } from "@/activity-log-view";

export const metadata: Metadata = { title: "Log · Kakkoi Chat", robots: { index: false } };

/** Everything this browser recorded about its requests, with the chat text beside it, for debugging. */
export default function LogPage() {
  return <ActivityLog />;
}
