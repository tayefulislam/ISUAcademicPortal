import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Send, Search, MessageCircle, ArrowLeft } from 'lucide-react';
import { messageApi } from '../../api/endpoints.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { formatDate } from '../../utils/format.js';

// Direct Faculty <-> Student messaging (Admin/Super Admin can message
// anyone). No websocket layer exists in this app, so both the conversation
// list and the open thread poll on an interval — consistent with the rest
// of the app's simplicity.
export default function Messages() {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [showContacts, setShowContacts] = useState(false);
  const [activeId, setActiveId] = useState(null);
  const [draft, setDraft] = useState('');
  const bottomRef = useRef(null);

  const { data: conversations } = useQuery({
    queryKey: ['conversations'],
    queryFn: messageApi.conversations,
    refetchInterval: 8000,
  });
  const { data: contacts } = useQuery({
    queryKey: ['message-contacts', search],
    queryFn: () => messageApi.contacts(search),
    enabled: showContacts,
  });
  const { data: messages } = useQuery({
    queryKey: ['messages', activeId],
    queryFn: () => messageApi.messages(activeId),
    enabled: !!activeId,
    refetchInterval: 4000,
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages?.data?.length]);

  const conversationList = conversations?.data || [];
  const activeConversation = conversationList.find((c) => c._id === activeId);

  const openContact = async (contact) => {
    try {
      const res = await messageApi.startConversation(contact._id);
      setActiveId(res.data._id);
      setShowContacts(false);
      setSearch('');
      qc.invalidateQueries({ queryKey: ['conversations'] });
    } catch (err) {
      toast(err.response?.data?.message || 'Could not start conversation', 'error');
    }
  };

  const send = async (e) => {
    e.preventDefault();
    if (!draft.trim() || !activeId) return;
    const text = draft.trim();
    setDraft('');
    try {
      await messageApi.send(activeId, text);
      qc.invalidateQueries({ queryKey: ['messages', activeId] });
      qc.invalidateQueries({ queryKey: ['conversations'] });
    } catch (err) {
      toast(err.response?.data?.message || 'Message failed to send', 'error');
    }
  };

  return (
    <div className="h-[calc(100vh-9rem)] flex bg-white border border-slate-200 rounded-xl overflow-hidden">
      <div className={`w-full sm:w-72 shrink-0 border-r border-slate-200 flex-col ${activeId ? 'hidden sm:flex' : 'flex'}`}>
        <div className="p-3 border-b border-slate-200 flex items-center gap-2">
          <button
            onClick={() => setShowContacts((v) => !v)}
            className="flex-1 h-9 rounded-lg bg-brand-600 text-white text-sm font-medium"
          >
            New message
          </button>
        </div>

        {showContacts && (
          <div className="p-3 border-b border-slate-200 space-y-2">
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name..."
                className="w-full h-9 rounded-lg border border-slate-300 pl-8 pr-2 text-sm"
              />
            </div>
            <div className="max-h-48 overflow-y-auto space-y-1">
              {(contacts?.data || []).map((c) => (
                <button
                  key={c._id}
                  onClick={() => openContact(c)}
                  className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-slate-100 text-sm"
                >
                  <span className="font-medium text-slate-700">{c.name}</span>
                  <span className="text-xs text-slate-400 ml-1.5 capitalize">{c.role}</span>
                </button>
              ))}
              {!contacts?.data?.length && <p className="text-xs text-slate-400 px-2.5 py-1">No matches</p>}
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          {conversationList.length === 0 && !showContacts && (
            <p className="text-sm text-slate-400 p-4 text-center">No conversations yet.</p>
          )}
          {conversationList.map((c) => (
            <button
              key={c._id}
              onClick={() => setActiveId(c._id)}
              className={`w-full text-left px-3 py-2.5 border-b border-slate-100 hover:bg-slate-50 ${activeId === c._id ? 'bg-brand-50' : ''}`}
            >
              <div className="flex items-center justify-between">
                <span className="font-medium text-sm text-slate-700 truncate">{c.otherParticipant?.name || 'Unknown'}</span>
                {c.unreadCount > 0 && (
                  <span className="shrink-0 bg-brand-600 text-white text-[10px] font-bold rounded-full px-1.5 py-0.5">{c.unreadCount}</span>
                )}
              </div>
              <p className="text-xs text-slate-400 truncate mt-0.5">{c.lastMessageText || 'No messages yet'}</p>
            </button>
          ))}
        </div>
      </div>

      <div className={`flex-1 flex-col ${activeId ? 'flex' : 'hidden sm:flex'}`}>
        {!activeId ? (
          <div className="flex-1 flex items-center justify-center text-slate-400 gap-2">
            <MessageCircle size={20} /> Select a conversation
          </div>
        ) : (
          <>
            <div className="h-14 shrink-0 flex items-center gap-2 px-4 border-b border-slate-200 font-semibold text-slate-700">
              <button onClick={() => setActiveId(null)} className="sm:hidden -ml-1 p-1 text-slate-400 hover:text-slate-600">
                <ArrowLeft size={18} />
              </button>
              {activeConversation?.otherParticipant?.name || '...'}
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {(messages?.data || []).map((m) => {
                const mine = m.sender?._id === user?._id || m.sender === user?._id;
                return (
                  <div key={m._id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[70%] rounded-2xl px-3.5 py-2 text-sm ${mine ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-700'}`}>
                      <p>{m.text}</p>
                      <p className={`text-[10px] mt-1 ${mine ? 'text-brand-100' : 'text-slate-400'}`}>{formatDate(m.createdAt)}</p>
                    </div>
                  </div>
                );
              })}
              <div ref={bottomRef} />
            </div>
            <form onSubmit={send} className="p-3 border-t border-slate-200 flex gap-2">
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Type a message..."
                className="flex-1 h-10 rounded-lg border border-slate-300 px-3 text-sm"
              />
              <button className="h-10 w-10 shrink-0 rounded-lg bg-brand-600 text-white flex items-center justify-center">
                <Send size={16} />
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
