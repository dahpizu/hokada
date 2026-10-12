import { useEffect, useState } from "react";
import { MessageCircle, Send } from "lucide-react";
import { supabase } from "../lib/supabase";

const CHAT_ENABLED_STATUSES = ["arrived", "collected", "arrived_at_dropoff"];

export default function TrackingChat({ deliveryId, status }) {
  const [messages, setMessages] = useState([]);
  const [messageText, setMessageText] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [customerUser, setCustomerUser] = useState(null);

  const chatEnabled = CHAT_ENABLED_STATUSES.includes(status);

  useEffect(() => {
    if (!supabase) {
      return;
    }

    let mounted = true;

    async function loadCustomerSession() {
      const {
        data: { user },
        error,
      } = await supabase.auth.getUser();

      if (error) {
        console.error("Could not get customer session:", error);
        return;
      }

      if (mounted) {
        setCustomerUser(user || null);
      }
    }

    loadCustomerSession();

    return () => {
      mounted = false;
    };
  }, []);

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
        console.error("Could not load chat messages:", error);
        return;
      }

      if (mounted) {
        setMessages(data || []);
      }
    }

    loadMessages();

    const channel = supabase
      .channel(`delivery-chat:${deliveryId}`)
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
        console.log("HOKADA customer chat realtime:", subscriptionStatus);
      });

    return () => {
      mounted = false;
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
        error: userError,
      } = await supabase.auth.getUser();

      if (userError) {
        console.error("Could not get logged-in customer:", userError);

        alert("Your login session could not be verified.");
        return;
      }

      if (!user) {
        alert("Please log in again before sending a message.");
        return;
      }

      setCustomerUser(user);

      const { error } = await supabase.from("delivery_messages").insert({
        delivery_id: deliveryId,
        sender_id: user.id,
        sender_type: "customer",
        message,
      });

      if (error) {
        console.error("Could not send customer message:", error);

        alert(`Could not send your message: ${error.message}`);

        return;
      }

      setMessageText("");
    } catch (error) {
      console.error("Customer chat error:", error);

      alert(
        `Could not send your message: ${error?.message || "Unknown error"}`
      );
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
