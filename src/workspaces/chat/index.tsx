import { Navigate, Route, Routes } from 'react-router'
import { ChatScreen } from './ChatScreen'

/**
 * Chat (§6.2). Routes under `chat/*`: `/chat` (the list; the stage shows a new conversation),
 * `/chat/new` (a new conversation — on phones, the stage), `/chat/:threadId` (`?m=` scrolls to a message).
 * Every route renders the same ChatScreen element, so moving between them keeps the list's state.
 */
export default function ChatWorkspace() {
  return (
    <Routes>
      <Route index element={<ChatScreen />} />
      <Route path="new" element={<ChatScreen />} />
      <Route path=":threadId" element={<ChatScreen />} />
      <Route path="*" element={<Navigate to="/chat" replace />} />
    </Routes>
  )
}
