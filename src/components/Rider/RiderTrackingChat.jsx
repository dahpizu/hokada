import { useEffect, useState } from "react";
import { MessageCircle, Send } from "lucide-react";
import { riderApiRequest } from "../../lib/riderApi";

const CHAT_ENABLED_STATUSES = ["arrived", "collected"];

export default function RiderTrackingChat({ deliveryId, status }) {
  const [messages, setMessages] = useState([]);
  const [messageText, setMessageText] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const chatEnabled = CHAT_ENABLED_STATUSES.includes(status);

  useEffect(() => {
    if (!deliveryId || !chatEnabled || !isOpen) {
      return;
    }

    let mounted = true;

    async function loadMessages() {
      try {
        const { messages: data } = await riderApiRequest(
          `/api/rider/deliveries/${encodeURIComponent(deliveryId)}/messages`
        );
        if (mounted) setMessages(data || []);
      } catch (error) {
        if (mounted) console.error("Could not load rider chat messages:", error);
      }
    }

    void loadMessages();
    const pollingInterval = window.setInterval(() => void loadMessages(), 5000);

    return () => {
      mounted = false;
      window.clearInterval(pollingInterval);
    };
  }, [deliveryId, chatEnabled, isOpen]);

  useEffect(() => {
    if (!chatEnabled) {
      setIsOpen(false);
    }
  }, [chatEnabled]);

  async function sendMessage(event) {
    event.preventDefault();

    const message = messageText.trim();

    if (!message || !chatEnabled || !deliveryId || loading) {
      return;
    }

    try {
      setLoading(true);

      const { message: savedMessage } = await riderApiRequest(
        `/api/rider/deliveries/${encodeURIComponent(deliveryId)}/messages`,
        { method: "POST", body: JSON.stringify({ message }) }
      );
      setMessages((previous) => [...previous, savedMessage]);
      setMessageText("");
    } catch (error) {
      console.error("Rider chat error:", error);
      alert(error.message || "Could not send your message.");
    } finally {
      setLoading(false);
    }
  }

  if (!deliveryId) {
    return null;
  }

  return (
    <section className="rider-chat-section">
      <div className="rider-chat-header">
        <div>
          <span className="rider-eyebrow">CUSTOMER COMMUNICATION</span>

          <h3>Chat with customer</h3>
        </div>

        <div
          className={`rider-chat-status ${
            chatEnabled ? "enabled" : "disabled"
          }`}
        >
          <MessageCircle size={16} />

          {chatEnabled ? "Chat available" : "Chat unavailable"}
        </div>
      </div>

      {!chatEnabled ? (
        <div className="rider-chat-locked">
          <MessageCircle size={22} />

          <div>
            <strong>Chat is temporarily unavailable</strong>

            <span>
              Chat is available when you arrive at pickup, after the package is
              collected, and when you arrive at drop-off.
            </span>
          </div>
        </div>
      ) : (
        <>
          <button
            type="button"
            className="rider-chat-open-button"
            onClick={() => setIsOpen((previous) => !previous)}
          >
            <MessageCircle size={19} />

            {isOpen ? "Close chat" : "Open chat"}

            {messages.length > 0 && (
              <span className="rider-chat-count">{messages.length}</span>
            )}
          </button>

          {isOpen && (
            <div className="rider-chat-box">
              <div className="rider-chat-messages">
                {messages.length === 0 ? (
                  <div className="rider-chat-empty">
                    <MessageCircle size={28} />

                    <strong>No messages yet</strong>

                    <span>Send a message to the customer.</span>
                  </div>
                ) : (
                  messages.map((message) => {
                    const isRider = message.sender_type === "rider";

                    return (
                      <div
                        key={message.id}
                        className={`rider-chat-message ${
                          isRider ? "rider" : "customer"
                        }`}
                      >
                        <div className="rider-chat-bubble">
                          <span>{message.message}</span>

                          <small>
                            {new Date(message.created_at).toLocaleTimeString(
                              "en-NG",
                              {
                                hour: "numeric",
                                minute: "2-digit",
                              }
                            )}
                          </small>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              <form className="rider-chat-input-row" onSubmit={sendMessage}>
                <input
                  value={messageText}
                  onChange={(event) => setMessageText(event.target.value)}
                  placeholder="Message customer..."
                  maxLength={500}
                />

                <button
                  type="submit"
                  disabled={loading || !messageText.trim()}
                  title="Send message"
                >
                  <Send size={18} />
                </button>
              </form>
            </div>
          )}
        </>
      )}
    </section>
  );
}
