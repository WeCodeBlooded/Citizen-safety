import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import './TouristSupportCenter.css';

const SUPPORTED_LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'hi', label: 'हिन्दी' },
  { code: 'bn', label: 'বাংলা' },
  { code: 'ta', label: 'தமிழ்' },
  { code: 'te', label: 'తెలుగు' },
  { code: 'mr', label: 'मराठी' },
  { code: 'kn', label: 'ಕನ್ನಡ' }
];

const REGION_OPTIONS = [
  { value: 'all', label: 'All Regions' },
  { value: 'National', label: 'National' },
  { value: 'Delhi', label: 'Delhi' },
  { value: 'Maharashtra', label: 'Maharashtra' },
  { value: 'Tamil Nadu', label: 'Tamil Nadu' },
  { value: 'Karnataka', label: 'Karnataka' },
  { value: 'Kerala', label: 'Kerala' },
  { value: 'Goa', label: 'Goa' },
  { value: 'Rajasthan', label: 'Rajasthan' }
];

const QUICK_PROMPTS = [
  { label: 'Lost passport', message: 'I lost my passport. What should I do?' },
  { label: 'Need medical help', message: 'Where can I get medical assistance right now?' },
  { label: 'Feel unsafe', message: 'I feel unsafe in this area. What should I do?' },
  { label: 'Language help', message: 'I need language assistance to talk to officials.' },
  { label: 'Currency exchange', message: 'Where can I safely exchange money or fix a blocked card?' }
];

const emptyState = [];

function TouristSupportCenter({ backendUrl, passportId }) {
  const [language, setLanguage] = useState('en');
  const [region, setRegion] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [helplines, setHelplines] = useState(emptyState);
  const [helplinesLoading, setHelplinesLoading] = useState(false);
  const [helplineError, setHelplineError] = useState('');
  const [chatMessages, setChatMessages] = useState([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState('');
  const [suggestedHelplines, setSuggestedHelplines] = useState(emptyState);

  const messageInputRef = useRef(null);
  const conversationRef = useRef(null);

  // Debounce search term to avoid excessive requests while typing
  useEffect(() => {
    const id = setTimeout(() => {
      setDebouncedSearch(searchTerm.trim());
    }, 350);
    return () => clearTimeout(id);
  }, [searchTerm]);

  const normalizedRegion = useMemo(() => {
    if (!region || region === 'all') return null;
    return region;
  }, [region]);

  useEffect(() => {
    if (!backendUrl) return () => {};

    let isMounted = true;
    const controller = new AbortController();

    async function loadHelplines() {
      setHelplineError('');
      setHelplinesLoading(true);

      try {
        const response = await axios.get(`${backendUrl}/api/v1/tourist-support/helplines`, {
          params: {
            language,
            region: normalizedRegion,
            query: debouncedSearch || undefined
          },
          withCredentials: true,
          signal: controller.signal
        });

        if (!isMounted) return;
        const list = response?.data?.helplines || emptyState;
        setHelplines(list);
      } catch (error) {
        if (axios.isCancel(error)) return;
        console.error('[TouristSupportCenter] Failed to load helplines:', error?.message || error);
        if (!isMounted) return;
        setHelplineError('Could not fetch helpline numbers right now. Please try again shortly.');
        setHelplines(emptyState);
      } finally {
        if (isMounted) {
          setHelplinesLoading(false);
        }
      }
    }

    loadHelplines();

    return () => {
      isMounted = false;
      controller.abort();
    };
  }, [backendUrl, language, normalizedRegion, debouncedSearch]);

  const scrollChatToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      if (conversationRef.current) {
        conversationRef.current.scrollTop = conversationRef.current.scrollHeight;
      }
    });
  }, []);

  const sendChatMessage = useCallback(async (text) => {
    const trimmed = (text || '').trim();
    if (!trimmed || !backendUrl) {
      return;
    }

    const userMessage = {
      id: `user-${Date.now()}`,
      sender: 'user',
      content: trimmed,
      timestamp: new Date().toISOString()
    };

    setChatMessages((prev) => [...prev, userMessage]);
    setChatLoading(true);
    setChatError('');
    scrollChatToBottom();

    try {
      const response = await axios.post(
        `${backendUrl}/api/v1/tourist-support/chat`,
        { message: trimmed, language },
        { withCredentials: true, timeout: 15000 }
      );

      const replyText = response?.data?.reply || 'I am still gathering details. Please stay safe and call 1800-11-1363 if you need immediate help.';
      const assistantMessage = {
        id: `assistant-${Date.now()}`,
        sender: 'assistant',
        content: replyText,
        timestamp: new Date().toISOString(),
        matchedKeywords: response?.data?.matchedKeywords || [],
        faqId: response?.data?.faqId || null,
        usedFallback: Boolean(response?.data?.usedFallback)
      };

      setChatMessages((prev) => [...prev, assistantMessage]);
      setSuggestedHelplines(response?.data?.suggestedHelplines || emptyState);
      scrollChatToBottom();
    } catch (error) {
      console.error('[TouristSupportCenter] Chat failed:', error?.message || error);
      setChatError('We could not reach the support service. Please try again or call 1800-11-1363.');
      setChatMessages((prev) => [
        ...prev,
        {
          id: `assistant-error-${Date.now()}`,
          sender: 'assistant',
          content: 'I could not reach the multilingual support desk right now. Please retry in a moment or call 1800-11-1363 for assistance.',
          timestamp: new Date().toISOString(),
          usedFallback: true
        }
      ]);
    } finally {
      setChatLoading(false);
    }
  }, [backendUrl, language, scrollChatToBottom]);

  const handleSubmit = useCallback((event) => {
    event.preventDefault();
    const message = messageInputRef.current?.value;
    if (!message) return;
    sendChatMessage(message);
    if (messageInputRef.current) {
      messageInputRef.current.value = '';
    }
  }, [sendChatMessage]);

  const handleQuickPrompt = useCallback((prompt) => {
    if (!prompt) return;
    sendChatMessage(prompt);
  }, [sendChatMessage]);

  const helplineList = useMemo(() => helplines.map((item) => ({
    id: item.id,
    region: item.region,
    serviceName: item.serviceName,
    phoneNumber: item.phoneNumber,
    availability: item.availability,
    languages: item.languages,
    description: item.description
  })), [helplines]);

  const chatPlaceholder = useMemo(() => {
    const activeLanguage = SUPPORTED_LANGUAGES.find((lang) => lang.code === language)?.label || 'English';
    return `Type your question in ${activeLanguage}…`;
  }, [language]);

  return (
    <div className="tourist-support">
      <div className="tourist-support__header">
        <div>
          <h3>Tourist Helpline &amp; Language Support</h3>
          <p className="muted">
            Connect with verified Indian tourist helplines and ask common safety queries in your preferred language.
          </p>
        </div>
        <div className="tourist-support__passport muted">Passport ID: {passportId || 'Active tourist session required'}</div>
      </div>

      <div className="tourist-support__controls">
        <label className="tourist-support__control">
          <span>Language</span>
          <select value={language} onChange={(e) => setLanguage(e.target.value)}>
            {SUPPORTED_LANGUAGES.map(({ code, label }) => (
              <option key={code} value={code}>{label}</option>
            ))}
          </select>
        </label>
        <label className="tourist-support__control">
          <span>Region</span>
          <select value={region} onChange={(e) => setRegion(e.target.value)}>
            {REGION_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <label className="tourist-support__control tourist-support__control--search">
          <span>Filter by keyword</span>
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="e.g. hospital, police, emergency"
          />
        </label>
      </div>

      <div className="tourist-support__content">
        <div className="tourist-support__helplines">
          <div className="tourist-support__section-title">Verified helpline numbers</div>
          {helplinesLoading && <p className="tourist-support__status">Loading helplines…</p>}
          {helplineError && <p className="tourist-support__status tourist-support__status--error">{helplineError}</p>}
          {!helplinesLoading && !helplineError && helplineList.length === 0 && (
            <p className="tourist-support__status">No helplines match your filters. Try clearing the search or switch to National view.</p>
          )}
          <ul className="tourist-support__helpline-list">
            {helplineList.map((entry) => (
              <li key={entry.id} className="tourist-support__helpline-item">
                <div className="tourist-support__helpline-heading">
                  <span className="tourist-support__helpline-name">{entry.serviceName}</span>
                  <span className="tourist-support__badge">{entry.region}</span>
                </div>
                {entry.description && <p className="tourist-support__helpline-description">{entry.description}</p>}
                <div className="tourist-support__helpline-meta">
                  <div>
                    <span className="tourist-support__label">Phone:</span>
                    <a href={`tel:${(entry.phoneNumber || '').replace(/[^0-9+]/g, '')}`} className="tourist-support__phone">
                      {entry.phoneNumber}
                    </a>
                  </div>
                  <div>
                    <span className="tourist-support__label">Availability:</span> {entry.availability || '24x7'}
                  </div>
                  <div>
                    <span className="tourist-support__label">Languages:</span> {(entry.languages || []).join(', ') || 'English'}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className="tourist-support__chat">
          <div className="tourist-support__section-title">Ask a safety question</div>
          <div className="tourist-support__quick">
            {QUICK_PROMPTS.map((prompt) => (
              <button
                key={prompt.label}
                type="button"
                className="tourist-support__quick-button"
                onClick={() => handleQuickPrompt(prompt.message)}
                disabled={chatLoading}
              >
                {prompt.label}
              </button>
            ))}
          </div>

          <div className="tourist-support__conversation" ref={conversationRef}>
            {chatMessages.length === 0 && (
              <div className="tourist-support__placeholder">
                Start the conversation to receive translated tips and the right helpline suggestions instantly.
              </div>
            )}
            {chatMessages.map((msg) => (
              <div
                key={msg.id}
                className={`tourist-support__message tourist-support__message--${msg.sender}`}
              >
                <div className="tourist-support__message-text">{msg.content}</div>
                {msg.matchedKeywords && msg.matchedKeywords.length > 0 && (
                  <div className="tourist-support__message-meta">
                    Matched: {msg.matchedKeywords.join(', ')}
                  </div>
                )}
              </div>
            ))}
          </div>

          <form className="tourist-support__form" onSubmit={handleSubmit}>
            <input
              ref={messageInputRef}
              type="text"
              placeholder={chatPlaceholder}
              disabled={chatLoading}
            />
            <button type="submit" disabled={chatLoading}>
              {chatLoading ? 'Sending…' : 'Send'}
            </button>
          </form>
          {chatError && <p className="tourist-support__status tourist-support__status--error" style={{ marginTop: 8 }}>{chatError}</p>}

          {suggestedHelplines.length > 0 && (
            <div className="tourist-support__suggested">
              <div className="tourist-support__suggested-title">Suggested helplines</div>
              <ul>
                {suggestedHelplines.slice(0, 3).map((entry) => (
                  <li key={entry.id}>
                    <strong>{entry.serviceName}</strong>
                    <span className="tourist-support__suggested-meta"> {entry.phoneNumber} &middot; {entry.region}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
export default TouristSupportCenter;
