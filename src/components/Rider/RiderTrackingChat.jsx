import { useEffect, useState } from "react";
import { MessageCircle, Send } from "lucide-react";
import { supabase } from "../../lib/supabase";

const CHAT_ENABLED_STATUSES = ["arrived", "collected", "arrived_at_dropoff"];

export default function RiderTrackingChat({ deliveryId, status }) {
  const [messages, setMessages] = useState([]);
  const [messageText, setMessageText] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const chatEnabled = CHAT_ENABLED_STATUSES.includes(status);

  useEffect(() => {
    if (!supabase || !deliveryId) {
      return;
    }

    let mounted = true;

    async function loadMessages() {
      const { data, error } = await supabase
        .from("delivery_messages")
        .select("id, delivery_id, sender_id, sender_type, message, created_at")
        .eq("delivery_id", deliveryId)
        .order("created_at", { ascending: true });

      if (error) {
        console.error("Could not load rider chat messages:", error);
        return;
      }

      if (mounted) {
        setMessages(data || []);
      }
    }

    // Load messages immediately
    loadMessages();

    // Keep checking for new messages
    const pollingInterval = setInterval(() => {
      loadMessages();
    }, 2000);

    // Also listen for realtime messages
    const channel = supabase
      .channel(`rider-chat:${deliveryId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "delivery_messages",
          filter: `delivery_id=eq.${deliveryId}`,
        },
        (payload) => {
          if (!mounted) {
            return;
          }

          setMessages((previous) => {
            const exists = previous.some(
              (message) => message.id === payload.new.id
            );

            if (exists) {
              return previous;
            }

            return [...previous, payload.new];
          });
        }
      )
      .subscribe((subscriptionStatus) => {
        console.log("HOKADA rider chat realtime:", subscriptionStatus);
      });

    return () => {
      mounted = false;
      clearInterval(pollingInterval);
      supabase.removeChannel(channel);
    };
  }, [deliveryId]);

  useEffect(() => {
    if (!chatEnabled) {
      setIsOpen(false);
    }
  }, [chatEnabled]);

  async function sendMessage(event) {
    event.preventDefault();

    const message = messageText.trim();

    if (!message || !chatEnabled || !supabase || !deliveryId || loading) {
      return;
    }

    try {
      setLoading(true);

      const {
        data: { user },
      } = await supabase.auth.getUser();

      const { error } = await supabase.from("delivery_messages").insert({
        delivery_id: deliveryId,
        sender_id: user?.id || null,
        sender_type: "rider",
        message,
      });

      if (error) {
        console.error("Could not send rider message:", error);
        alert("Could not send your message.");
        return;
      }

      setMessageText("");

      // Immediately reload after sending
      await loadMessagesAfterSend();
    } catch (error) {
      console.error("Rider chat error:", error);
      alert("Could not send your message.");
    } finally {
      setLoading(false);
    }
  }

  async function loadMessagesAfterSend() {
    if (!supabase || !deliveryId) {
      return;
    }

    const { data, error } = await supabase
      .from("delivery_messages")
      .select("id, delivery_id, sender_id, sender_type, message, created_at")
      .eq("delivery_id", deliveryId)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("Could not refresh rider chat messages:", error);
      return;
    }

    setMessages(data || []);
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
