// Turnstile.jsx
import { useEffect, useRef } from "react";

export default function Turnstile({ onVerify, onExpire, onError }) {
  const ref = useRef(null);
  const widgetId = useRef(null);

  useEffect(() => {
    const render = () => {
      if (!window.turnstile || !ref.current) return;
      widgetId.current = window.turnstile.render(ref.current, {
        sitekey: '0x4AAAAAAEJUQokk0eOAXxml', // your site key
        callback: (token) => onVerify?.(token),
        "expired-callback": () => onExpire?.(),
        "error-callback": () => onError?.(),
        theme: "dark",
        size: "normal",
      });
    };

    if (window.turnstile) {
      render();
    } else {
      const s = document.createElement("script");
      s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      s.async = true;
      s.onload = render;
      document.body.appendChild(s);
    }

    return () => {
      if (widgetId.current != null && window.turnstile) {
        window.turnstile.remove(widgetId.current);
      }
    };
  }, [onVerify, onExpire, onError]);

  return <div ref={ref} className="turnstileWrap" />;
}