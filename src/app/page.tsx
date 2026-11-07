import { connection } from "next/server";
import ChatPage from "@/chat-page";
import { chatModelLabels, isChatModelId } from "@/lib/chat-models";
import { defaultChatModelId } from "@/lib/default-chat-model";

export default async function Page() {
  await connection();
  const id = defaultChatModelId();
  const label = isChatModelId(id) ? chatModelLabels[id].replace(/ \(hosted\)$/, "") : id;
  return <ChatPage defaultModelLabel={label} />;
}
