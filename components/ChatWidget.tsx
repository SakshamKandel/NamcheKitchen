'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Bot, ChevronDown, MessageCircle, Send, ShieldCheck, UserRound, X } from 'lucide-react';

type ChatRole = 'user' | 'assistant';
type ChatMessage = { role: ChatRole; content: string };
type ChatImage = { name: string; type: 'image/jpeg' | 'image/png' | 'image/webp'; data: string };
type OwnerProposal = { token: string; summary: string; tool: string };

const publicWelcome =
  "Namaste! I can help you explore today’s menu and request a table. I can’t edit the menu or change restaurant content.";
const ownerWelcome =
  'Namaste. I can read your menu and prepare changes to names, descriptions, prices, availability, featured dishes, and food images. I will show you a review before anything is saved.';

function Bubble({ message }: { message: ChatMessage }) {
  const lines = message.content.split(/\r?\n/);
  const inline = (value: string) => value.split(/(\*\*[^*]+\*\*)/g).map((part, index) => part.startsWith('**') && part.endsWith('**') ? <strong key={index}>{part.slice(2, -2)}</strong> : <span key={index}>{part}</span>);
  return (
    <div className={`chat-message ${message.role}`}>
      <span className="chat-avatar" aria-hidden="true">
        {message.role === 'assistant' ? <Bot size={15} /> : <UserRound size={15} />}
      </span>
      <div className="chat-message-copy">
        {message.role === 'user' ? <p>{message.content}</p> : <>
          {lines.map((line, index) => {
            const heading = line.match(/^#{2,4}\s+(.+)$/);
            if (heading) return <h3 className="chat-heading" key={index}>{inline(heading[1])}</h3>;
            if (line.trim().startsWith('- ')) return <div className="chat-menu-item" key={index}><span className="chat-bullet" aria-hidden="true">•</span><span>{inline(line.trim().slice(2))}</span></div>;
            if (!line.trim()) return <span className="chat-spacer" key={index} />;
            return <p key={index}>{inline(line)}</p>;
          })}
        </>}
      </div>
    </div>
  );
}

function ChatPanel({ owner = false, onClose }: { owner?: boolean; onClose?: () => void }) {
  const router = useRouter();
  const [messages, setMessages] = useState<ChatMessage[]>([{ role: 'assistant', content: owner ? ownerWelcome : publicWelcome }]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [uploadingImage, setUploadingImage] = useState(false);
  const [attachment, setAttachment] = useState<ChatImage | undefined>();
  const [proposal, setProposal] = useState<OwnerProposal | undefined>();
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, busy]);

  async function sendMessage(value = input) {
    const content = value.trim();
    if (!content || busy) return;
    const next = [...messages, { role: 'user' as const, content }];
    setMessages(next);
    setInput('');
    setError('');
    if (owner) setProposal(undefined);
    setBusy(true);
    try {
      const response = await fetch(owner ? '/api/chat/owner' : '/api/chat/public', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: next, ...(owner && attachment ? { image: attachment } : {}) }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'The assistant is unavailable right now.');
      const reply = typeof data.message === 'string' ? data.message : typeof data.reply === 'string' ? data.reply : 'I’m sorry, I could not answer that.';
      setMessages(current => [...current, { role: 'assistant', content: reply }]);
      if (owner) setProposal(data.proposal && typeof data.proposal.token === 'string' ? data.proposal as OwnerProposal : undefined);
      const imageSaved = Array.isArray(data.changes) && data.changes.some((change: unknown) => {
        if (!change || typeof change !== 'object') return false;
        const result = change as { ok?: unknown; message?: unknown };
        return result.ok === true && result.message === 'Image uploaded.';
      });
      if (imageSaved) setAttachment(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The assistant is unavailable right now.');
    } finally {
      setBusy(false);
    }
  }

  async function confirmProposal() {
    if (!owner || !proposal || busy) return;
    const content = 'I approve this proposed change. Please apply it.';
    const next = [...messages, { role: 'user' as const, content }];
    setMessages(next);
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/chat/owner', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: next, confirmationToken: proposal.token, confirm: true, ...(attachment ? { image: attachment } : {}) }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'The change could not be saved.');
      const committed = data.committed === true;
      setMessages(current => [...current, { role: 'assistant', content: typeof data.message === 'string' ? data.message : committed ? 'The change was saved.' : 'The change was not saved.' }]);
      if (committed) {
        setProposal(undefined);
        setAttachment(undefined);
        router.refresh();
      } else {
        // Confirmation tokens are single-use even when validation rejects the
        // write. Start a fresh proposal instead of offering a dead button.
        setProposal(undefined);
        setError(typeof data.message === 'string' ? data.message : 'The change was not saved. Ask me to prepare it again.');
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The change could not be saved.');
    } finally {
      setBusy(false);
    }
  }

  async function uploadImage(file: File) {
    setError('');
    setUploadingImage(true);
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error('Image must be under 5 MB.');
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Choose a JPG, PNG, or WebP image.');
      const data = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('This image could not be read.')); reader.onerror = () => reject(new Error('This image could not be read.')); reader.readAsDataURL(file); });
      setAttachment({ name: file.name, type: file.type as ChatImage['type'], data });
      setInput('I attached a new menu image. Please assign it to the dish I name next.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'This image could not be uploaded.');
    } finally {
      setUploadingImage(false);
    }
  }

  const suggestions = owner ? ['Show hidden dishes', 'What needs an image?', 'Review menu categories'] : ['What is on the menu?', 'I want to reserve a table', 'What are your hours?'];

  return (
    <section className={`chat-panel ${owner ? 'chat-panel-owner' : ''}`} aria-label={owner ? 'Owner AI assistant' : 'Namche Kitchen assistant'}>
      <header className="chat-panel-header">
        <div>
          <img className="chat-logo" src="/api/images/logo" alt="Namche Kitchen" />
          <h2>{owner ? 'Manage your kitchen.' : 'How can we help?'}</h2>
          <p>{owner ? 'Menu and image operations stay behind your staff session.' : 'Menu questions and table requests.'}</p>
        </div>
        {onClose && <button className="chat-close" type="button" onClick={onClose} aria-label="Close assistant"><X size={19} /></button>}
      </header>
      <div className="chat-messages" aria-live="polite">
        {messages.map((message, index) => <Bubble message={message} key={`${message.role}-${index}`} />)}
        {busy && <div className="chat-typing" role="status"><span /><span /><span /> Thinking…</div>}
        <div ref={endRef} />
      </div>
      {owner && proposal && <div className="chat-confirm-card" role="group" aria-label="Proposed menu change"><span className="chat-confirm-label">PROPOSED CHANGE</span><strong>{proposal.summary}</strong><p>Review this menu change before saving it.</p><div className="chat-confirm-actions"><button type="button" className="chat-confirm-primary" onClick={() => void confirmProposal()} disabled={busy}>Confirm &amp; save</button><button type="button" className="chat-confirm-cancel" onClick={() => setProposal(undefined)} disabled={busy}>Cancel</button></div></div>}
      {messages.length === 1 && <div className="chat-suggestions">{suggestions.map(suggestion => <button key={suggestion} type="button" onClick={() => void sendMessage(suggestion)}>{suggestion}</button>)}</div>}
      {error && <p className="chat-error" role="alert">{error}</p>}
      <form className="chat-composer" onSubmit={event => { event.preventDefault(); void sendMessage(); }}>
        {owner && <label className="chat-upload" title="Attach a menu image"><input type="file" accept="image/jpeg,image/png,image/webp" onChange={event => { const file = event.target.files?.[0]; if (file) void uploadImage(file); event.currentTarget.value = ''; }} disabled={busy || uploadingImage} /><span aria-hidden="true">{uploadingImage ? '…' : attachment ? '✓' : '+'}</span><span className="sr-only">Attach a menu image</span></label>}
        <label className="sr-only" htmlFor={owner ? 'owner-chat-input' : 'public-chat-input'}>Message the assistant</label>
        <input id={owner ? 'owner-chat-input' : 'public-chat-input'} value={input} onChange={event => setInput(event.target.value)} placeholder={owner ? 'Ask to review or update the menu…' : 'Ask about the menu or a table…'} maxLength={1200} disabled={busy || uploadingImage} />
        <button type="submit" aria-label="Send message" disabled={busy || !input.trim()}><Send size={18} /></button>
      </form>
      <p className="chat-disclaimer">{owner ? <><ShieldCheck size={13} /> Owner actions require confirmation and your staff session.</> : <><ShieldCheck size={13} /> I can request a reservation, but only staff can confirm it.</>}</p>
    </section>
  );
}

export default function PublicChatWidget() {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  if (path === '/admin' || path.startsWith('/admin/')) return null;
  return <div className="chat-widget"><button className={`chat-launcher ${open ? 'is-open' : ''}`} type="button" onClick={() => setOpen(value => !value)} aria-expanded={open} aria-controls="public-chat-panel"><MessageCircle size={21} /><span>{open ? 'Close chat' : 'Chat with us'}</span>{open && <ChevronDown size={17} />}</button>{open && <div id="public-chat-panel"><ChatPanel onClose={() => setOpen(false)} /></div>}</div>;
}

export function OwnerChatAssistant() {
  return <ChatPanel owner />;
}
