import { useEffect, useState } from "react";
import { MessageCircle, Send } from "lucide-react";
import { customerApiRequest } from "../lib/customerApi";

const CHAT_ENABLED_STATUSES = ["arrived", "collected"];

export default function TrackingChat({ deliveryId, status, paymentStatus }) {
  const [messages, setMessages] = useState([]);
  const [messageText, setMessageText] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const chatEnabled =
    CHAT_ENABLED_STATUSES.includes(status) && paymentStatus !== "paid";

  useEffect(() => {
    if (!deliveryId || !chatEnabled || !isOpen) {
      return;
    }

    let mounted = true;

    async function loadMessages() {
      try {
        const { messages: data } = await customerApiRequest(
          `/api/deliveries/${encodeURIComponent(deliveryId)}/messages`
        );

        if (mounted) setMessages(data || []);
      } catch (error) {
        if (mounted) console.error("Could not load chat messages:", error);
      }
    }

    void loadMessages();
    const refreshTimer = window.setInterval(() => void loadMessages(), 5000);

    return () => {
      mounted = false;
      window.clearInterval(refreshTimer);
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
      const { message: savedMessage } = await customerApiRequest(
        `/api/deliveries/${encodeURIComponent(deliveryId)}/messages`,
        { method: "POST", body: JSON.stringify({ message }) }
      );
      setMessages((previous) => [...previous, savedMessage]);
      setMessageText("");
    } catch (error) {
      console.error("Customer chat error:", error);
      alert(`Could not send your message: ${error?.message || "Unknown error"}`);
    } finally {
      setLoading(false);
    }
  }

  if (!deliveryId) {
    return null;
  }

  return (
    <section className="hokada-chat-section">
      <div className="hokada-chat-header">
        <div>
          <span className="eyebrow">RIDER COMMUNICATION</span>

          <h3>Chat with rider</h3>
        </div>

        <div
          className={`hokada-chat-status ${
            chatEnabled ? "enabled" : "disabled"
          }`}
        >
          <MessageCircle size={16} />

          {chatEnabled ? "Chat available" : "Chat unavailable"}
        </div>
      </div>

      {!chatEnabled ? (
        <div className="hokada-chat-locked">
          <MessageCircle size={22} />

          <div>
            <strong>Chat is temporarily unavailable</strong>

            <span>
              Chat becomes available when the rider arrives at pickup, after the
              package is collected, and when the rider arrives at drop-off.
            </span>
          </div>
        </div>
      ) : (
        <>
          <button
            type="button"
            className="hokada-chat-open-button"
            onClick={() => setIsOpen((previous) => !previous)}
          >
            <MessageCircle size={19} />

            {isOpen ? "Close chat" : "Open chat"}

            {messages.length > 0 && (
              <span className="hokada-chat-count">{messages.length}</span>
            )}
          </button>

          {isOpen && (
            <div className="hokada-chat-box">
              <div className="hokada-chat-messages">
                {messages.length === 0 ? (
                  <div className="hokada-chat-empty">
                    <MessageCircle size={28} />

                    <strong>No messages yet</strong>

                    <span>Send a message to your rider.</span>
                  </div>
                ) : (
                  messages.map((message) => {
                    const isCustomer = message.sender_type === "customer";

                    return (
                      <div
                        key={message.id}
                        className={`hokada-chat-message ${
                          isCustomer ? "customer" : "rider"
                        }`}
                      >
                        <div className="hokada-chat-bubble">
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

              <form className="hokada-chat-input-row" onSubmit={sendMessage}>
                <input
                  value={messageText}
                  onChange={(event) => setMessageText(event.target.value)}
                  placeholder="Type a message..."
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
