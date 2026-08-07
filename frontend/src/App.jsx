import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";

/* ---------- deterministic torn-parchment edge generator ---------- */
function seededRand(i) {
  const x = Math.sin(i * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}
function tornPolygon(perSide = 20, jitter = 2.2, seedOffset = 0) {
  const pts = [];
  const addEdge = (x0, y0, x1, y1, seedBase) => {
    for (let i = 0; i <= perSide; i++) {
      const t = i / perSide;
      let x = x0 + (x1 - x0) * t;
      let y = y0 + (y1 - y0) * t;
      const r = seededRand(seedBase + i + seedOffset) * 2 - 1;
      const r2 = seededRand(seedBase + i * 3.7 + seedOffset) * 2 - 1;
      if (x0 === x1) x += r * jitter + r2 * jitter * 0.5;
      else y += r * jitter + r2 * jitter * 0.5;
      pts.push(`${x.toFixed(2)}% ${y.toFixed(2)}%`);
    }
  };
  addEdge(0, 0, 100, 0, 1);
  addEdge(100, 0, 100, 100, 90);
  addEdge(100, 100, 0, 100, 180);
  addEdge(0, 100, 0, 0, 270);
  return `polygon(${pts.join(",")})`;
}
const TORN_CLIP = tornPolygon(22, 1.8, 0);
const TORN_CLIP_UNDER = tornPolygon(22, 3.1, 7);

/* ---------------------------- icons ---------------------------- */
function DiamondMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 0 L11 8 L8 16 L5 8 Z" fill="#5c3a28" opacity="0.85" />
    </svg>
  );
}
function QuillIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 60 140" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M30 4C40 20 52 34 50 58C48 82 34 100 22 116L12 138" stroke="#2a1c12" strokeWidth="2" opacity="0.9" />
      <path d="M30 4C22 22 12 30 14 52C16 74 26 84 34 92C40 78 46 60 44 42C42 24 36 12 30 4Z" fill="#1a120c" opacity="0.95" />
      <path d="M18 40C24 44 30 44 36 40M16 56C23 61 31 61 38 56M17 72C24 77 31 77 38 72" stroke="#4a3020" strokeWidth="1" opacity="0.55" />
      <path d="M22 116L34 92" stroke="#7a5a30" strokeWidth="1.4" opacity="0.75" />
    </svg>
  );
}
function CandleIcon({ lit }) {
  return (
    <svg width="46" height="90" viewBox="0 0 46 90" aria-hidden="true">
      <rect x="16" y="40" width="14" height="44" rx="2" fill="#d8c8a8" />
      <rect x="16" y="40" width="14" height="44" rx="2" fill="url(#candleShade)" opacity="0.55" />
      <defs>
        <linearGradient id="candleShade" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#000" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#000" stopOpacity="0" />
        </linearGradient>
        <radialGradient id="flameGrad" cx="50%" cy="70%" r="60%">
          <stop offset="0%" stopColor="#fff3c4" />
          <stop offset="35%" stopColor="#ff9a40" />
          <stop offset="75%" stopColor="#c43a1c" />
          <stop offset="100%" stopColor="#c43a1c" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect x="22" y="34" width="2" height="8" fill="#2a1c12" />
      <g className={lit ? "candleFlame lit" : "candleFlame"} style={{ transformOrigin: "23px 34px" }}>
        <ellipse cx="23" cy="20" rx="9" ry="16" fill="url(#flameGrad)" />
      </g>
    </svg>
  );
}

/* ---------------------------- left scene ---------------------------- */
function NightScene({ fireLevel, fireEmbers, imageSrc, revealed }) {
  const glowClass =
    fireLevel === 2 ? " bright" : fireLevel === 1 ? " boost" : fireLevel === -1 ? " settle" : "";

  const [imgFailed, setImgFailed] = useState(false);

  const dust = useMemo(
    () =>
      Array.from({ length: 12 }).map((_, i) => ({
        id: i,
        left: 6 + seededRand(i * 23.4) * 88,
        top: 8 + seededRand(i * 31.7) * 75,
        delay: i * 1.15,
      })),
    []
  );

  return (
    <div className={`leftScene${revealed ? " revealed" : ""}`} aria-hidden="true">
      {!imgFailed ? (
        <video
          className="knightImg"
          autoPlay
          loop
          muted
          playsInline
          preload="auto"
          onError={() => setImgFailed(true)}
        >
          <source src={imageSrc} type="video/mp4" />
        </video>
      ) : (
        <div className="knightFallback" />
      )}

      <div className={`fireGlow${glowClass}`} />
      <div className={`armorLight${glowClass}`} />
      <div className={`wallLight${glowClass}`} />

      <div className="smoke">
        <span className="smokeWisp w1" />
        <span className="smokeWisp w2" />
        <span className="smokeWisp w3" />
      </div>

      <div className="embers">
        {Array.from({ length: 9 }).map((_, i) => (
          <span
            key={i}
            className="ember"
            style={{ left: `${47 + i * 2.6}%`, animationDelay: `${i * 0.65}s` }}
          />
        ))}
      </div>

      <div className="keyEmbers" aria-hidden="true">
        {fireEmbers.map((em) => (
          <span
            key={em.id}
            className="keyEmber"
            style={{ left: `${em.left}%`, "--kx": `${em.drift}px` }}
          />
        ))}
      </div>

      <div className="dustLayer" aria-hidden="true">
        {dust.map((d) => (
          <span
            key={d.id}
            className="dustMote"
            style={{ left: `${d.left}%`, top: `${d.top}%`, animationDelay: `${d.delay}s` }}
          />
        ))}
      </div>

      <div className="owlWrap" aria-hidden="true">
        <svg className="owlSilhouette" viewBox="0 0 60 60" xmlns="http://www.w3.org/2000/svg">
          <ellipse cx="30" cy="34" rx="16" ry="20" fill="#06060a" />
          <circle cx="22" cy="24" r="6" fill="#06060a" />
          <circle cx="38" cy="24" r="6" fill="#06060a" />
          <circle cx="22" cy="24" r="2.2" fill="#c9a05a" opacity="0.9" />
          <circle cx="38" cy="24" r="2.2" fill="#c9a05a" opacity="0.9" />
          <path d="M30 30 L26 37 L34 37 Z" fill="#06060a" />
          <path d="M14 38C10 42 10 48 14 52" stroke="#06060a" strokeWidth="4" strokeLinecap="round" />
          <path d="M46 38C50 42 50 48 46 52" stroke="#06060a" strokeWidth="4" strokeLinecap="round" />
        </svg>
      </div>

      <div className="shootingStarWrap" aria-hidden="true">
        <span className="shootingStar" />
      </div>

      <div className="leftGradient" />
      <div className="grain" />
    </div>
  );
}

/* ---------------------------- validation helpers ---------------------------- */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i;

function isFutureDateTime(dateStr, timeStr) {
  if (!dateStr || !timeStr) return false;
  const target = new Date(`${dateStr}T${timeStr}`);
  if (Number.isNaN(target.getTime())) return false;
  return target.getTime() > Date.now() - 60_000;
}

const HINTS = {
  message: "The parchment awaits your words, ashen one.",
  messageShort: "Speak more. A single breath will not carry far.",
  messageLong: "The page can hold no more. Condense your will.",
  date: "When shall these words find you again?",
  datePast: "Time only moves forward. Choose a day yet to come.",
  time: "Name the hour the letter shall return.",
  email: "Name the place the letter shall seek.",
  emailInvalid: "That path is broken. Give a true address.",
};

/* Stub traveler letters (replace with real backend later) */
const TRAVELER_LETTERS = [
  {
    id: "t1",
    text: "I left this fire warmer than I found it. May you do the same.",
    name: "Anonymous Traveler",
    mood: "hopeful",
  },
  {
    id: "t2",
    text: "The night is long, but the embers remember every face that sat beside them.",
    name: "A weary knight",
    mood: "reflective",
  },
  {
    id: "t3",
    text: "If you are reading this, you are not alone at the last campfire.",
    name: "Anonymous Traveler",
    mood: "comforting",
  },
];

/* ---------------------------- app ---------------------------- */
const KNIGHT_IMAGE_SRC = "/Knight_Resting.mov";

export default function App() {
  const [loadStage, setLoadStage] = useState(0);
  const [message, setMessage] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("12:00");
  const [email, setEmail] = useState("");
  const [errors, setErrors] = useState({});
  const [touched, setTouched] = useState({});
  const [phase, setPhase] = useState("writing");
  const [fireLevel, setFireLevel] = useState(0);
  const [fireEmbers, setFireEmbers] = useState([]);
  const [shake, setShake] = useState(false);
  const [postSealEmbers, setPostSealEmbers] = useState(false);
  const [inkStains, setInkStains] = useState([]);
  const [paperDust, setPaperDust] = useState([]);

  // New dual-path states
  const [journeyModal, setJourneyModal] = useState(false);
  const [letterPath, setLetterPath] = useState(null); // "return" | "adrift"
  const [displayName, setDisplayName] = useState("");
  const [mood, setMood] = useState("");
  const [readingMode, setReadingMode] = useState(false);
  const [currentTravelerLetter, setCurrentTravelerLetter] = useState(null);
  const [bottleAnimating, setBottleAnimating] = useState(false);
  const [showReturnFields, setShowReturnFields] = useState(false);

  const flareTimeout = useRef(null);
  const settleTimeout = useRef(null);
  const brightTimeout = useRef(null);
  const streakRef = useRef(0);
  const emberIdRef = useRef(0);
  const layerRef = useRef(null);
  const last = useRef(0);
  const quillRef = useRef(null);
  const mouse = useRef({ x: 0, y: 0 });
  const quillPos = useRef({ x: 0, y: 0 });
  const rafId = useRef(null);
  const textareaRef = useRef(null);
  const inkSettleTimeout = useRef(null);
  const audioRef = useRef(null);

  const wordCount = message.trim().length ? message.trim().split(/\s+/).length : 0;
  const charCount = message.length;

  useEffect(() => {
    const t1 = setTimeout(() => setLoadStage(1), 650);
    const t2 = setTimeout(() => setLoadStage(2), 1350);
    const t3 = setTimeout(() => setLoadStage(3), 2050);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, []);

  const ashEmbers = useMemo(() => {
    return Array.from({ length: 20 }).map((_, i) => {
      const kinds = ["ash-orange", "ash-gray", "ash-white"];
      return {
        id: i,
        left: 2 + seededRand(i * 3.1) * 96,
        delay: seededRand(i * 5.7) * 9,
        duration: 8 + seededRand(i * 9.3) * 7,
        drift: (seededRand(i * 13.1) - 0.5) * 160,
        size: 1.8 + seededRand(i * 17.2) * 2.6,
        kind: kinds[i % 3],
      };
    });
  }, []);

  useEffect(() => {
    const layer = layerRef.current;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    function onMove(e) {
      mouse.current = { x: e.clientX, y: e.clientY };
      if (reduce || !layer) return;
      const now = performance.now();
      if (now - last.current < 60) return;
      last.current = now;
      const spark = document.createElement("div");
      spark.className = "spark";
      spark.style.left = `${e.clientX}px`;
      spark.style.top = `${e.clientY}px`;
      spark.style.setProperty("--dx", `${(Math.random() - 0.5) * 16}px`);
      spark.style.setProperty("--dy", `${-16 - Math.random() * 16}px`);
      layer.appendChild(spark);
      setTimeout(() => spark.remove(), 900);
    }
    window.addEventListener("mousemove", onMove);

    function tick() {
      // tighter tracking so the quill stays close to the real cursor
      quillPos.current.x += (mouse.current.x - quillPos.current.x) * 0.55;
      quillPos.current.y += (mouse.current.y - quillPos.current.y) * 0.55;
      if (quillRef.current) {
        quillRef.current.style.transform = `translate(${quillPos.current.x - 4}px, ${quillPos.current.y - 8}px) rotate(38deg)`;
      }
      rafId.current = requestAnimationFrame(tick);
    }
    if (!reduce) rafId.current = requestAnimationFrame(tick);

    return () => {
      window.removeEventListener("mousemove", onMove);
      if (rafId.current) cancelAnimationFrame(rafId.current);
    };
  }, []);

  const spawnFireEmber = useCallback(() => {
    const id = emberIdRef.current++;
    const left = 49 + Math.random() * 9;
    const drift = (Math.random() - 0.5) * 28;
    setFireEmbers((prev) => [...prev.slice(-24), { id, left, drift }]);
    setTimeout(() => {
      setFireEmbers((prev) => prev.filter((em) => em.id !== id));
    }, 1900);
  }, []);

  const flare = useCallback(() => {
    setFireLevel((lvl) => (lvl === -1 ? -1 : 1));
    if (flareTimeout.current) clearTimeout(flareTimeout.current);
    flareTimeout.current = setTimeout(() => setFireLevel(0), 420);
  }, []);

  const handleMessageChange = useCallback(
    (e) => {
      const nextVal = e.target.value.slice(0, 1200);

      if (textareaRef.current) {
        textareaRef.current.classList.add("justTyped");
        if (inkSettleTimeout.current) clearTimeout(inkSettleTimeout.current);
        inkSettleTimeout.current = setTimeout(() => {
          textareaRef.current && textareaRef.current.classList.remove("justTyped");
        }, 260);
      }

      setMessage((prevMsg) => {
        const delta = nextVal.length - prevMsg.length;

        if (delta > 0) {
          spawnFireEmber();

          if (Math.random() < 0.18) {
            const id = Date.now() + Math.random();
            setInkStains((prev) => [
              ...prev.slice(-6),
              {
                id,
                left: 12 + Math.random() * 76,
                top: 18 + Math.random() * 55,
                size: 4 + Math.random() * 9,
                opacity: 0.12 + Math.random() * 0.18,
              },
            ]);
            setTimeout(() => {
              setInkStains((prev) => prev.filter((s) => s.id !== id));
            }, 4200);
          }

          if (Math.random() < 0.28) {
            const id = Date.now() + Math.random();
            setPaperDust((prev) => [
              ...prev.slice(-10),
              {
                id,
                left: 8 + Math.random() * 84,
                top: 12 + Math.random() * 70,
                delay: Math.random() * 0.4,
              },
            ]);
            setTimeout(() => {
              setPaperDust((prev) => prev.filter((d) => d.id !== id));
            }, 2600);
          }

          streakRef.current += delta;
          setFireLevel((lvl) => (lvl === 2 ? 2 : 1));

          if (streakRef.current >= 5) {
            streakRef.current = 0;
            setFireLevel(2);
            if (brightTimeout.current) clearTimeout(brightTimeout.current);
            brightTimeout.current = setTimeout(() => setFireLevel(1), 700);
          }

          if (settleTimeout.current) clearTimeout(settleTimeout.current);
          settleTimeout.current = setTimeout(() => setFireLevel(0), 500);
        } else if (delta < 0) {
          streakRef.current = 0;
          setFireLevel(-1);
          if (brightTimeout.current) clearTimeout(brightTimeout.current);
          if (settleTimeout.current) clearTimeout(settleTimeout.current);
          settleTimeout.current = setTimeout(() => setFireLevel(0), 550);
        }
        return nextVal;
      });

      if (touched.message) {
        setErrors((p) => {
          const n = { ...p };
          if (!nextVal.trim()) n.message = HINTS.message;
          else if (nextVal.trim().length < 8) n.message = HINTS.messageShort;
          else if (nextVal.length >= 1200) n.message = HINTS.messageLong;
          else delete n.message;
          return n;
        });
      } else {
        clearError("message");
      }
    },
    [spawnFireEmber, touched.message]
  );

  useEffect(
    () => () => {
      flareTimeout.current && clearTimeout(flareTimeout.current);
      settleTimeout.current && clearTimeout(settleTimeout.current);
      brightTimeout.current && clearTimeout(brightTimeout.current);
      inkSettleTimeout.current && clearTimeout(inkSettleTimeout.current);
    },
    []
  );

  function clearError(field) {
    setErrors((p) => {
      if (!p[field]) return p;
      const n = { ...p };
      delete n[field];
      return n;
    });
  }

  function markTouched(field) {
    setTouched((p) => ({ ...p, [field]: true }));
  }

  function validateReturnFields() {
    const next = {};
    if (!date) next.date = HINTS.date;
    else if (!isFutureDateTime(date, time || "00:00")) next.date = HINTS.datePast;
    if (!time) next.time = HINTS.time;
    if (!email.trim()) next.email = HINTS.email;
    else if (!EMAIL_RE.test(email.trim())) next.email = HINTS.emailInvalid;
    setErrors((p) => ({ ...p, ...next }));
    setTouched((p) => ({ ...p, date: true, time: true, email: true }));
    return Object.keys(next).length === 0;
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (phase !== "writing") return;

    if (!message.trim() || message.trim().length < 8) {
      setErrors({ message: HINTS.messageShort });
      setShake(true);
      setTimeout(() => setShake(false), 420);
      return;
    }

    // open the cinematic choice modal
    setJourneyModal(true);
  }

  function sealLetter(path) {
    setJourneyModal(false);
    setLetterPath(path);

    if (path === "return") {
      setShowReturnFields(true);
      // user still needs to fill date/time/email, then click seal again
      return;
    }

    // adrift path – seal immediately
    performSeal(path);
  }

  function performSeal(path) {
    setFireLevel(2);
    setTimeout(() => setFireLevel(1), 600);
    setTimeout(() => setFireLevel(-1), 1400);

    setPhase("folding");
    setTimeout(() => setPhase("sealing"), 520);
    setTimeout(() => {
      setShake(true);
      setTimeout(() => setShake(false), 420);
    }, 900);
    setTimeout(() => {
      setPhase("sealed");
      setPostSealEmbers(true);
      // TODO: send to backend
      // path === "return" → scheduled letter
      // path === "adrift" → anonymous traveler letter
    }, 1180);
  }

  function handleFinalReturnSeal() {
    if (!validateReturnFields()) {
      setShake(true);
      setTimeout(() => setShake(false), 420);
      return;
    }
    performSeal("return");
  }

  function handleBottleClick() {
    if (bottleAnimating || readingMode) return;
    setBottleAnimating(true);

    setTimeout(() => {
      const letter = TRAVELER_LETTERS[Math.floor(Math.random() * TRAVELER_LETTERS.length)];
      setCurrentTravelerLetter(letter);
      setReadingMode(true);
      setBottleAnimating(false);
    }, 1600);
  }

  function handleReset() {
    setMessage("");
    setDate("");
    setTime("12:00");
    setEmail("");
    setErrors({});
    setTouched({});
    setPhase("writing");
    setFireLevel(0);
    setPostSealEmbers(false);
    setInkStains([]);
    setPaperDust([]);
    setFireEmbers([]);
    setJourneyModal(false);
    setLetterPath(null);
    setShowReturnFields(false);
    setDisplayName("");
    setMood("");
    setReadingMode(false);
    setCurrentTravelerLetter(null);
  }

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = 0.15;
    audio.loop = true;
    audio.play().catch(() => {});
  }, []);

  const formattedDate = date
    ? new Date(`${date}T${time || "00:00"}`).toLocaleString(undefined, {
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";

  const minDate = useMemo(() => {
    const d = new Date();
    return d.toISOString().slice(0, 10);
  }, []);

  const parchmentFireClass =
    fireLevel === 2 ? " fireBright" : fireLevel === 1 ? " fireBoost" : fireLevel === -1 ? " fireSettle" : "";

  return (
    <div className={`stage${shake ? " shake" : ""} breathing${journeyModal || readingMode ? " modalOpen" : ""}`}>
      <audio ref={audioRef} src="/Bg_Music_BoneFire.mp3" preload="auto" />
      <style>{CSS}</style>

      <div className="vignette" aria-hidden="true" />

      {loadStage < 3 && (
        <div className={`loadingScreen${loadStage >= 1 ? " fadeOut" : ""}`}>
          <CandleIcon lit={loadStage >= 0} />
          <div className="loadingCaption">the fire fades&hellip;</div>
        </div>
      )}

      <div className="emberLayer" ref={layerRef} aria-hidden="true" />
      {!journeyModal && !readingMode && (
        <div className="quillCursor" ref={quillRef} aria-hidden="true">
          <QuillIcon className="quillSvg" />
        </div>
      )}

      <div className="ashLayer" aria-hidden="true">
        {ashEmbers.map((a) => (
          <span
            key={a.id}
            className={`ash ${a.kind}`}
            style={{
              left: `${a.left}%`,
              width: `${a.size}px`,
              height: `${a.size}px`,
              animationDelay: `${a.delay}s`,
              animationDuration: `${a.duration}s`,
              "--driftX": `${a.drift}px`,
            }}
          />
        ))}
      </div>

      <NightScene
        fireLevel={fireLevel}
        fireEmbers={fireEmbers}
        imageSrc={KNIGHT_IMAGE_SRC}
        revealed={loadStage >= 2}
      />

      <div className={`rightWrap${loadStage >= 1 ? " revealed" : ""}`}>
        <section className="parchmentShadow" style={{ clipPath: TORN_CLIP_UNDER }} aria-hidden="true" />
        <section
          className={`parchment phase-${phase}${message.trim() ? " inked" : ""}${parchmentFireClass}${fireLevel > 0 ? " writing" : ""}`}
          style={{ clipPath: TORN_CLIP }}
          aria-label="Letter to your future self"
        >
          <div className="parchmentLight" aria-hidden="true" />
          <div className="parchmentFireSpill" aria-hidden="true" />
          <div className="parchmentBurn" aria-hidden="true" />
          <div className="parchmentWrinkles" aria-hidden="true" />
          <div className="candleFlicker" aria-hidden="true" />
          <div className="curl" aria-hidden="true" />
          <div className="fold foldA" aria-hidden="true" />
          <div className="fold foldB" aria-hidden="true" />
          <div className="stain s1" />
          <div className="stain s2" />
          <div className="stain s3" />
          <div className="stain s4" />
          <div className="stain s5" />
          <div className="bloodStain" aria-hidden="true" />

          {inkStains.map((s) => (
            <div
              key={s.id}
              className="liveInkStain"
              style={{
                left: `${s.left}%`,
                top: `${s.top}%`,
                width: `${s.size}px`,
                height: `${s.size * 0.7}px`,
                opacity: s.opacity,
              }}
            />
          ))}

          {paperDust.map((d) => (
            <div
              key={d.id}
              className="paperDust"
              style={{
                left: `${d.left}%`,
                top: `${d.top}%`,
                animationDelay: `${d.delay}s`,
              }}
            />
          ))}

          <div className="content">
            <div className="markRow">
              <DiamondMark />
            </div>
            <div className="hairline" />

            <h1 className="heading">
              Leave a letter
              <br />
              <span className="headingSoft">for the person waiting</span>
              <br />
              beyond tomorrow.
            </h1>
            <p className="subheading">
              The path is long and the fire grows cold.
              <br />
              <span className="soft">Do not go hollow.</span>
            </p>
            <div className="poemDivider">&mdash;&mdash; &#9671; &mdash;&mdash;</div>

            <form className="letterForm" onSubmit={handleSubmit} noValidate>
              <div className="letterInner">
                <div className="letterHead">
                  <span className="dearLine">Bearer of these words,</span>
                  <span className="wordCounter">
                    {wordCount} word{wordCount === 1 ? "" : "s"} · {charCount}/1200
                  </span>
                </div>

                <div className="writeArea">
                  <textarea
                    ref={textareaRef}
                    placeholder="Leave behind what today cannot carry&hellip;"
                    value={message}
                    onChange={handleMessageChange}
                    onBlur={() => {
                      markTouched("message");
                    }}
                    className={errors.message ? "invalid" : ""}
                    aria-invalid={!!errors.message}
                    disabled={phase !== "writing"}
                    maxLength={1200}
                  />
                  <QuillIcon className="restingQuill" />
                  <div className={`hint${errors.message ? " error" : ""}`}>
                    {errors.message || ""}
                  </div>
                </div>

                {/* Return fields only appear after choosing "Return them to me" */}
                {showReturnFields && (
                  <>
                    <div className="sectionDivider" aria-hidden="true">
                      &mdash;&mdash;&mdash; &#9671; &mdash;&mdash;&mdash;
                    </div>
                    <div className="fieldsRow">
                      <div className="field">
                        <div className="fieldLabel">When shall these words find you again?</div>
                        <div className="fieldInline">
                          <input
                            type="date"
                            className={`lineInput${errors.date ? " invalid" : ""}`}
                            value={date}
                            min={minDate}
                            onChange={(e) => {
                              setDate(e.target.value);
                              clearError("date");
                            }}
                            onBlur={() => markTouched("date")}
                            onKeyDown={flare}
                            disabled={phase !== "writing"}
                          />
                          <input
                            type="time"
                            className={`lineInput${errors.time ? " invalid" : ""}`}
                            value={time}
                            onChange={(e) => {
                              setTime(e.target.value);
                              clearError("time");
                              clearError("date");
                            }}
                            onBlur={() => markTouched("time")}
                            onKeyDown={flare}
                            disabled={phase !== "writing"}
                          />
                        </div>
                        <div className={`caption${errors.date || errors.time ? " error" : ""}`}>
                          {errors.date || errors.time || "Choose the day these words should find you."}
                        </div>
                      </div>

                      <div className="field">
                        <div className="fieldLabel">Name the place the letter shall seek.</div>
                        <input
                          type="email"
                          className={`lineInput fullWidth${errors.email ? " invalid" : ""}`}
                          placeholder="you@realm.com"
                          value={email}
                          onChange={(e) => {
                            setEmail(e.target.value);
                            clearError("email");
                          }}
                          onBlur={() => markTouched("email")}
                          onKeyDown={flare}
                          disabled={phase !== "writing"}
                          autoComplete="email"
                        />
                        <div className={`caption${errors.email ? " error" : ""}`}>
                          {errors.email || "This is where your words will return."}
                        </div>
                      </div>
                    </div>
                  </>
                )}

                <div className="sectionDivider" aria-hidden="true">
                  &mdash;&mdash;&mdash; &#9671; &mdash;&mdash;&mdash;
                </div>

                <div className="ctaRow">
                  {showReturnFields ? (
                    <button
                      className="sealButton"
                      type="button"
                      onClick={handleFinalReturnSeal}
                      disabled={phase !== "writing"}
                    >
                      <span className="sealStack">
                        <span className="sealCircle">&#9670;</span>
                        <span className="sealCaption">Traveler's Seal</span>
                        <span className="sealText">Bind to the appointed hour</span>
                      </span>
                    </button>
                  ) : (
                    <button className="sealButton" type="submit" disabled={phase !== "writing"}>
                      <span className="ctaEmbers" aria-hidden="true">
                        {Array.from({ length: 6 }).map((_, i) => (
                          <span
                            key={i}
                            className="ctaEmber"
                            style={{ left: `${16 + i * 52}px`, animationDelay: `${i * 130}ms` }}
                          />
                        ))}
                      </span>
                      <span className="sealStack">
                        <span className="sealCircle">&#9670;</span>
                        <span className="sealCaption">Blood Seal</span>
                        <span className="sealText">
                          {phase === "folding"
                            ? "Folding\u2026"
                            : phase === "sealing"
                            ? "Sealing\u2026"
                            : "Entrust to the Flame"}
                        </span>
                      </span>
                    </button>
                  )}
                </div>

                <div className="lockCaption">
                  <span className="lockIcon">&#128274;</span> Bound until the appointed hour. Do not go hollow.
                </div>
              </div>

              {phase === "sealing" && (
                <div className="waxDrop" aria-hidden="true">
                  <span className="waxBlob" />
                </div>
              )}

              <div className={`sealedOverlay${phase === "sealed" ? " show" : ""}`}>
                {(phase === "sealed" || postSealEmbers) && (
                  <div className="riseEmbers" aria-hidden="true">
                    {Array.from({ length: 11 }).map((_, i) => (
                      <span
                        key={i}
                        className="riseEmber"
                        style={{ left: `${8 + i * 8}%`, animationDelay: `${i * 110}ms` }}
                      />
                    ))}
                  </div>
                )}
                <div className="bigWax">
                  <div className="bigWaxInner">&#9670;</div>
                </div>
                <div className="sealedTitle">
                  The fire has accepted
                  <br />
                  your words.
                </div>
                <p className="sealedBody">
                  {letterPath === "adrift"
                    ? "They now drift with the smoke, waiting for another traveler."
                    : "The next traveler to read them will be you."}
                </p>
                {letterPath === "return" && formattedDate && (
                  <div className="sealedMeta">
                    Sealed until {formattedDate} · returning to {email}
                  </div>
                )}
                <button type="button" className="writeAnother" onClick={handleReset}>
                  Inscribe another letter
                </button>
              </div>
            </form>
          </div>

          </section>

        {/* Glass bottle – outside parchment so clip-path does not hide it */}
        <button
          className={`glassBottle ${bottleAnimating ? "rising" : ""}`}
          onClick={handleBottleClick}
          title="A traveler left this by the fire"
          aria-label="Open a letter left by another traveler"
          disabled={bottleAnimating || readingMode}
        >
          <img
            src="/GLass_Bottle.png"
            alt=""
            className="bottleImg"
            draggable="false"
          />
        </button>
      </div>

      {/* Journey modal */}
{journeyModal && (
  <div className="journeyOverlay">
    <div className="journeyModal">
      <div className="journeyTitle">Where shall these words journey?</div>

      <div className="journeyOptions">
        <button className="journeyChoice" onClick={() => sealLetter("return")}>
          <span className="choiceTitle">Return to Me</span>
          <span className="choiceDesc">
            Let these words sleep until the day<br />
            they are meant to return.
          </span>
        </button>

        <button className="journeyChoice" onClick={() => sealLetter("adrift")}>
          <span className="choiceTitle">Leave By The Fire</span>
          <span className="choiceDesc">
            Cast these words into the fire.<br />
            Another traveler may discover them<br />
            one quiet night.
          </span>
        </button>
      </div>

      <button className="journeyCancel" onClick={() => setJourneyModal(false)}>
        The words are not yet ready
      </button>
    </div>
  </div>
)}

      {/* Reading mode */}
      {readingMode && currentTravelerLetter && (
        <div className="readingOverlay">
          <div className="readingParchment">
            <div className="rpBurn rpBurn1" aria-hidden="true" />
            <div className="rpBurn rpBurn2" aria-hidden="true" />
            <div className="rpCoffee" aria-hidden="true" />
            <div className="rpWax" aria-hidden="true" />
            <div className="rpFold rpFoldH" aria-hidden="true" />
            <div className="rpFold rpFoldV" aria-hidden="true" />
            <div className="rpCurl" aria-hidden="true" />
            <div className="rpFade" aria-hidden="true" />

            <div className="readingHeader">A letter found by the fire</div>
            <div className="readingBody">{currentTravelerLetter.text}</div>
            <div className="readingMeta">
              — {currentTravelerLetter.name}
              {currentTravelerLetter.mood && ` · ${currentTravelerLetter.mood}`}
            </div>
            <button
              className="readingClose"
              onClick={() => {
                setReadingMode(false);
                setCurrentTravelerLetter(null);
              }}
            >
              Return it to the night
            </button>
          </div>
        </div>
      )}

      <div className="footerQuote">&#9671; Time remembers what we forget. &#9671;</div>
    </div>
  );
}

/* ---------------------------- styles ---------------------------- */
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,400;1,500&family=Cinzel:wght@500;600;700&family=IBM+Plex+Mono:wght@400;500&family=Caveat:wght@500;600;700&display=swap');

*{box-sizing:border-box;}
.stage{
  position:relative;
  min-height:100vh;
  width:100%;
  background:radial-gradient(120% 100% at 28% 18%, #070810 0%, #020208 50%, #010103 100%);
  overflow:hidden;
  cursor:none;
  font-family:'IBM Plex Mono',monospace;
}
.stage.modalOpen{ cursor:auto; }
.stage.modalOpen .quillCursor{ display:none; }
.stage.breathing{ animation: breathe 22s ease-in-out infinite; }
@keyframes breathe{
  0%,100%{ transform:translateY(0); }
  50%{ transform:translateY(-1.8px); }
}
@media (max-width:980px){ .stage{ cursor:auto; } }
.stage.shake{ animation:screenShake 420ms cubic-bezier(.36,.07,.19,.97); }
@keyframes screenShake{
  10%,90%{transform:translate3d(-1px,0,0);}
  20%,80%{transform:translate3d(2px,0,0);}
  30%,50%,70%{transform:translate3d(-4px,0,0);}
  40%,60%{transform:translate3d(4px,0,0);}
}

.vignette{
  position:fixed; inset:0; z-index:70; pointer-events:none;
  background:radial-gradient(ellipse 75% 70% at 45% 45%, transparent 40%, rgba(0,0,0,.55) 100%);
}

.loadingScreen{
  position:fixed; inset:0; z-index:200; background:#010103;
  display:flex; flex-direction:column; align-items:center; justify-content:center; gap:14px;
  transition:opacity 700ms ease; opacity:1;
}
.loadingScreen.fadeOut{ opacity:0; pointer-events:none; }
.loadingCaption{
  font-family:'Cormorant Garamond', serif; font-style:italic; color:rgba(180,160,130,.5); font-size:14px; letter-spacing:.08em;
}
.candleFlame{ transform:scale(0.2); opacity:0; transition:transform 500ms ease, opacity 500ms ease; }
.candleFlame.lit{ animation:candleFlicker 1.6s ease-in-out infinite; opacity:1; transform:scale(1); }
@keyframes candleFlicker{
  0%,100%{ transform:scale(1) rotate(0deg); }
  25%{ transform:scale(1.05,0.96) rotate(-2deg); }
  50%{ transform:scale(0.96,1.05) rotate(1deg); }
  75%{ transform:scale(1.02,0.98) rotate(-1deg); }
}

.emberLayer{ position:fixed; inset:0; z-index:80; pointer-events:none; mix-blend-mode:screen; }
.spark{
  position:absolute; top:0; left:0; width:4px; height:4px; border-radius:50%;
  background:radial-gradient(circle, rgba(255,160,70,.95), rgba(200,60,30,.35) 55%, transparent 75%);
  box-shadow:0 0 7px rgba(255,120,40,.5);
  animation:sparkLife 900ms ease-out forwards;
}
@keyframes sparkLife{
  0%{opacity:.85; transform:translate(-50%,-50%) scale(1);}
  100%{opacity:0; transform:translate(calc(-50% + var(--dx,0px)), calc(-50% + var(--dy,-24px))) scale(.3);}
}
.quillCursor{ position:fixed; top:0; left:0; z-index:90; pointer-events:none; will-change:transform; }
.quillSvg{ width:26px; height:60px; filter:drop-shadow(0 2px 4px rgba(0,0,0,.6)); }
@media (max-width:980px){ .quillCursor{ display:none; } }

.ashLayer{ position:fixed; inset:0; z-index:8; pointer-events:none; overflow:hidden; }
.ash{
  position:absolute; top:-4%; border-radius:50%; opacity:0;
  animation-name:ashFall; animation-timing-function:linear; animation-iteration-count:infinite;
}
.ash-orange{ background:#d06028; box-shadow:0 0 6px rgba(200,80,25,.5); }
.ash-gray{ background:#6a6460; box-shadow:0 0 4px rgba(100,95,90,.35); }
.ash-white{ background:#c0b8a8; box-shadow:0 0 5px rgba(180,170,150,.35); }
@keyframes ashFall{
  0%{ transform:translate(0,0) rotate(0deg); opacity:0; }
  8%{ opacity:.65; }
  92%{ opacity:.28; }
  100%{ transform:translate(var(--driftX), 108vh) rotate(140deg); opacity:0; }
}

.leftScene{
  position:absolute; inset:0; right:37%;
  overflow:hidden; background:#020308;
  opacity:0; transform:scale(1.02);
  transition:opacity 1100ms ease, transform 1400ms ease;
}
.leftScene.revealed{ opacity:1; transform:scale(1); }
.knightImg{
  position:absolute; inset:0;
  width:100%; height:100%;
  object-fit:cover;
  object-position:center 50%;
  display:block;
  filter:saturate(.7) brightness(.78) contrast(1.15) sepia(.08);
  transform:scale(1.02);
}
.knightFallback{
  position:absolute; inset:0;
  background:
    radial-gradient(60% 50% at 48% 72%, rgba(200,70,25,.22), transparent 60%),
    radial-gradient(120% 90% at 30% 10%, #0e0c14 0%, #06050a 55%, #020208 100%);
}

.fireGlow{
  position:absolute; left:51%; bottom:18%; width:240px; height:210px; border-radius:50%;
  background:radial-gradient(circle, rgba(220,80,30,.42), rgba(160,35,15,.14) 45%, transparent 72%);
  filter:blur(16px); opacity:.5; transition:opacity 280ms ease, filter 280ms ease, transform 280ms ease, background 280ms ease; z-index:3;
  animation:pulse 4.2s ease-in-out infinite;
  mix-blend-mode:screen;
  transform:translateX(-50%);
}
.fireGlow.boost{
  opacity:.9; filter:blur(12px) brightness(1.3); transform:translateX(-50%) scale(1.12);
  background:radial-gradient(circle, rgba(240,70,25,.58), rgba(170,30,12,.2) 45%, transparent 72%);
}
.fireGlow.bright{
  opacity:1; filter:blur(9px) brightness(1.65); transform:translateX(-50%) scale(1.25);
  background:radial-gradient(circle, rgba(255,55,20,.7), rgba(150,20,12,.28) 45%, transparent 74%);
}
.fireGlow.settle{ opacity:.22; filter:blur(20px) brightness(.7); transform:translateX(-50%) scale(.88); }
@keyframes pulse{0%,100%{transform:translateX(-50%) scale(1);opacity:.48;}50%{transform:translateX(-50%) scale(1.07);opacity:.65;}}

.armorLight{
  position:absolute; left:6%; bottom:8%; width:260px; height:320px; border-radius:50%;
  background:radial-gradient(circle, rgba(255,110,40,.22), transparent 72%);
  filter:blur(32px); opacity:.32; mix-blend-mode:screen; pointer-events:none; z-index:2;
  transition:opacity 280ms ease, filter 280ms ease;
}
.armorLight.boost{ opacity:.58; filter:blur(24px) brightness(1.25); }
.armorLight.bright{ opacity:.78; filter:blur(18px) brightness(1.45); }
.armorLight.settle{ opacity:.15; }

.wallLight{
  position:absolute; left:0; top:0; width:55%; height:100%;
  background:radial-gradient(80% 70% at 30% 70%, rgba(220,90,35,.16), transparent 65%);
  mix-blend-mode:screen; pointer-events:none; z-index:2;
  opacity:.4; transition:opacity 280ms ease;
}
.wallLight.boost{ opacity:.65; }
.wallLight.bright{ opacity:.85; }
.wallLight.settle{ opacity:.18; }

.embers{ position:absolute; left:0; bottom:20%; width:100%; height:220px; z-index:4; }
.ember{ position:absolute; bottom:0; width:3px; height:3px; border-radius:50%; background:#d06028; box-shadow:0 0 8px rgba(200,80,25,.55); opacity:0; animation:emberRise 5.2s linear infinite; }
@keyframes emberRise{0%{transform:translate(0,0) scale(1);opacity:0;}12%{opacity:.8;}100%{transform:translate(-8px,-160px) scale(.35);opacity:0;}}

.keyEmbers{ position:absolute; left:0; bottom:20%; width:100%; height:280px; z-index:5; pointer-events:none; }
.keyEmber{
  position:absolute; bottom:0; width:3px; height:3px; border-radius:50%;
  background:#ff9a40; box-shadow:0 0 9px rgba(240,100,40,.8);
  animation:keyEmberRise 1.9s ease-out forwards;
}
@keyframes keyEmberRise{
  0%{ transform:translate(0,0) scale(1); opacity:0; }
  10%{ opacity:1; }
  100%{ transform:translate(var(--kx,12px), -220px) scale(.3); opacity:0; }
}

.smoke{ position:absolute; left:51%; bottom:22%; width:110px; height:260px; z-index:3; pointer-events:none; mix-blend-mode:screen; opacity:.38; transform:translateX(-50%); }
.smokeWisp{
  position:absolute; bottom:0; left:50%; width:24px; height:85px; border-radius:50%;
  background:radial-gradient(circle, rgba(160,160,170,.16), transparent 70%);
  filter:blur(6px);
  animation:smokeRise 9s ease-in infinite;
}
.smokeWisp.w2{ left:35%; animation-duration:11s; animation-delay:2.4s; }
.smokeWisp.w3{ left:65%; animation-duration:12.5s; animation-delay:5s; }
@keyframes smokeRise{
  0%{ transform:translate(-50%,0) scale(.6); opacity:0; }
  15%{ opacity:.4; }
  100%{ transform:translate(calc(-50% + 22px), -250px) scale(1.55); opacity:0; }
}

.dustLayer{ position:absolute; inset:0; z-index:4; pointer-events:none; }
.dustMote{
  position:absolute; width:2.2px; height:2.2px; border-radius:50%;
  background:#c09050; box-shadow:0 0 5px rgba(180,130,70,.55);
  opacity:0; animation:dustFloat 7.5s ease-in-out infinite;
}
@keyframes dustFloat{
  0%,100%{ opacity:0; transform:translate(0,0); }
  20%{ opacity:.55; }
  50%{ transform:translate(10px,-14px); opacity:.75; }
  80%{ opacity:.3; }
}

.owlWrap{ position:absolute; top:12%; right:8%; width:34px; height:34px; z-index:5; pointer-events:none; opacity:0; animation:owlAppear 48s ease-in-out infinite; }
.owlSilhouette{ width:100%; height:100%; filter:drop-shadow(0 2px 3px rgba(0,0,0,.7)); }
@keyframes owlAppear{
  0%,88%{ opacity:0; }
  90%{ opacity:1; }
  95%{ opacity:1; }
  98%,100%{ opacity:0; }
}

.shootingStarWrap{ position:absolute; inset:0; z-index:6; pointer-events:none; overflow:hidden; }
.shootingStar{
  position:absolute; top:8%; left:-4%; width:2px; height:2px; border-radius:50%;
  background:#d8d0c0; box-shadow:0 0 6px 1px rgba(210,200,180,.75);
  opacity:0; animation:shootingStarGo 62s linear infinite;
}
.shootingStar::before{
  content:""; position:absolute; top:0; right:0; width:64px; height:1px;
  background:linear-gradient(90deg, rgba(210,200,180,.8), transparent);
}
@keyframes shootingStarGo{
  0%,60%{ opacity:0; transform:translate(0,0); }
  61%{ opacity:1; }
  68%{ opacity:0; transform:translate(210px,86px); }
  100%{ opacity:0; }
}

.leftGradient{
  position:absolute; inset:0; z-index:6; pointer-events:none;
  background:
    linear-gradient(180deg, rgba(0,0,4,.5) 0%, rgba(0,0,0,0) 20%, rgba(0,0,0,0) 58%, rgba(0,0,4,.65) 100%),
    linear-gradient(90deg, rgba(0,0,6,.4) 0%, rgba(0,0,0,0) 18%),
    linear-gradient(to right, rgba(1,1,6,.08) 0%, rgba(1,1,6,.25) 52%, rgba(3,1,1,.78) 100%),
    radial-gradient(120% 120% at 50% 50%, transparent 48%, rgba(0,0,4,.7) 100%);
}
.grain{
  position:absolute; inset:0; z-index:7; pointer-events:none; opacity:.4; mix-blend-mode:overlay;
  background-image:repeating-linear-gradient(0deg, rgba(255,255,255,.015) 0 1px, transparent 1px 3px);
}

.rightWrap{
  position:relative; z-index:5;
  min-height:100vh; display:flex; align-items:center; justify-content:center;
  padding:4vh 4vw 4vh calc(42% + 1vw);
  opacity:0; transform:translateY(10px) scale(.985);
  transition:opacity 900ms ease, transform 900ms ease;
}
.rightWrap.revealed{ opacity:1; transform:translateY(0) scale(1); }

.rightWrap::before{
  content:"";
  position:absolute;
  left:calc(22% - 40px);
  top:6%;
  bottom:6%;
  width:260px;
  background:radial-gradient(55% 100% at 100% 50%, rgba(0,0,0,.6), transparent 72%);
  filter:blur(24px);
  z-index:0;
  pointer-events:none;
}

.parchmentShadow{
  position:absolute; inset:22px 8px 14px 8px;
  background:
    linear-gradient(100deg, rgba(160,50,20,.28) 0%, rgba(12,6,2,.94) 45%, #0c0602 100%);
  filter:blur(10px);
  opacity:.75;
  z-index:0;
  transform:rotate(-1.4deg);
  animation:parchmentSway 7.5s ease-in-out infinite;
}
.parchment{
  position:relative; z-index:1;
  width:640px; max-width:100%;
  padding:34px 42px 30px;
  background:
    radial-gradient(120% 90% at 20% 0%, rgba(230,210,170,.38), transparent 55%),
    radial-gradient(90% 70% at 100% 100%, rgba(80,45,20,.35), transparent 60%),
    linear-gradient(155deg, #d0b480 0%, #bc9860 38%, #a88050 68%, #967048 100%);
  box-shadow:
    0 40px 90px rgba(0,0,0,.7),
    0 8px 22px rgba(0,0,0,.5),
    0 20px 60px rgba(0,0,0,.45),
    inset 0 0 80px rgba(255,255,255,.05),
    inset 0 0 120px rgba(50,25,0,.1);
  transition:filter 300ms ease, background 900ms ease, box-shadow 300ms ease;
  transform:rotate(-1.4deg);
  animation:parchmentSway 7.5s ease-in-out infinite;
  transform-origin:50% 42%;
}
@keyframes parchmentSway{
  0%,100%{ transform:rotate(-1.4deg) translate(0,0); }
  22%{ transform:rotate(-1.15deg) translate(0.3px,-0.2px); }
  50%{ transform:rotate(-1.65deg) translate(-0.25px,0.3px); }
  76%{ transform:rotate(-1.3deg) translate(0.2px,0.15px); }
}
.parchment.inked{ filter:brightness(.96) saturate(1.05); }
.parchment.writing{ filter:brightness(.93) saturate(1.08); }
.parchment.phase-folding{ filter:brightness(.9); }
.parchment.phase-sealing{ filter:brightness(.76) saturate(1.1); }
.parchment.phase-sealed{ filter:brightness(.84) saturate(1.05); }
.parchment::after{
  content:"";
  position:absolute; inset:0; pointer-events:none;
  background-image:
    repeating-linear-gradient(0deg, rgba(50,32,12,.045) 0 1px, transparent 1px 6px),
    repeating-linear-gradient(90deg, rgba(50,32,12,.03) 0 1px, transparent 1px 9px);
  mix-blend-mode:multiply;
}

.parchmentFireSpill{
  position:absolute; inset:0; pointer-events:none; z-index:1;
  background:radial-gradient(70% 90% at 0% 85%, rgba(255,130,50,.28), transparent 55%);
  mix-blend-mode:soft-light;
  opacity:.6;
  transition:opacity 280ms ease, filter 280ms ease;
}
.parchment.fireBoost .parchmentFireSpill{
  opacity:.95;
  filter:brightness(1.3);
  background:radial-gradient(75% 95% at 0% 85%, rgba(255,110,40,.42), transparent 58%);
}
.parchment.fireBright .parchmentFireSpill{
  opacity:1;
  filter:brightness(1.5);
  background:radial-gradient(80% 100% at 0% 85%, rgba(255,90,30,.55), transparent 60%);
}
.parchment.fireSettle .parchmentFireSpill{
  opacity:.22;
  filter:brightness(.7);
}

.parchmentLight{
  position:absolute; inset:0; pointer-events:none; z-index:1;
  background:
    radial-gradient(85% 75% at 2% 100%, rgba(200,90,35,.22), transparent 55%),
    linear-gradient(92deg, rgba(210,160,90,.07) 0%, transparent 30%, rgba(8,4,2,.14) 68%, rgba(5,2,1,.4) 100%);
  mix-blend-mode:soft-light;
}
.parchment.writing .parchmentLight{
  background:
    radial-gradient(90% 80% at 12% 90%, rgba(230,120,50,.34), transparent 55%),
    linear-gradient(92deg, rgba(230,170,100,.14) 0%, transparent 28%, rgba(8,4,2,.18) 70%, rgba(5,2,1,.42) 100%);
  animation:lightSweep 3.8s ease-in-out infinite;
}
@keyframes lightSweep{
  0%,100%{ opacity:.7; }
  50%{ opacity:1; }
}

.parchmentBurn{
  position:absolute; inset:0; pointer-events:none; z-index:1; mix-blend-mode:multiply;
  background:
    radial-gradient(150px 130px at 0% 0%, rgba(25,10,3,.72), transparent 58%),
    radial-gradient(150px 130px at 100% 0%, rgba(25,10,3,.68), transparent 58%),
    radial-gradient(170px 150px at 0% 100%, rgba(20,8,2,.7), transparent 60%),
    radial-gradient(170px 150px at 100% 100%, rgba(20,8,2,.74), transparent 60%),
    radial-gradient(70% 65% at 50% 42%, transparent 48%, rgba(18,8,2,.55) 100%);
}
.parchmentWrinkles{
  position:absolute; inset:0; pointer-events:none; z-index:1; opacity:.3; mix-blend-mode:overlay;
  background-image:
    linear-gradient(35deg, transparent 47%, rgba(230,210,170,.28) 49%, transparent 51%),
    linear-gradient(-50deg, transparent 60%, rgba(40,25,10,.3) 62%, transparent 64%),
    linear-gradient(12deg, transparent 30%, rgba(230,210,170,.18) 31.5%, transparent 33%),
    linear-gradient(-18deg, transparent 75%, rgba(40,25,10,.25) 76.5%, transparent 78%);
}
.candleFlicker{
  position:absolute; inset:0; pointer-events:none; z-index:1; mix-blend-mode:soft-light;
  background:radial-gradient(85% 75% at 4% 98%, rgba(210,100,40,.45), transparent 62%);
  animation:fireLight 3.2s ease-in-out infinite;
}
@keyframes fireLight{
  0%,100%{ opacity:.48; filter:brightness(1); }
  35%{ opacity:.62; filter:brightness(1.03); }
  60%{ opacity:.4; filter:brightness(0.96); }
  82%{ opacity:.55; filter:brightness(1.02); }
}

.liveInkStain{
  position:absolute;
  border-radius:60% 40% 55% 45%;
  background:radial-gradient(circle at 40% 40%, rgba(40,18,8,.55), transparent 70%);
  filter:blur(1.5px);
  pointer-events:none;
  z-index:3;
  animation:inkAppear 4.2s ease-out forwards;
}
@keyframes inkAppear{
  0%{ opacity:0; transform:scale(.4); }
  12%{ opacity:1; transform:scale(1.05); }
  80%{ opacity:1; }
  100%{ opacity:0; transform:scale(1); }
}
.paperDust{
  position:absolute;
  width:2.5px; height:2.5px; border-radius:50%;
  background:#c9a878;
  box-shadow:0 0 4px rgba(180,140,80,.4);
  pointer-events:none;
  z-index:4;
  opacity:0;
  animation:paperDustFloat 2.6s ease-out forwards;
}
@keyframes paperDustFloat{
  0%{ opacity:0; transform:translate(0,0) scale(.6); }
  15%{ opacity:.7; }
  100%{ opacity:0; transform:translate(8px,-28px) scale(.3); }
}

.fold{ position:absolute; pointer-events:none; mix-blend-mode:multiply; opacity:.32; }
.foldA{ top:0; bottom:0; left:33%; width:2px; background:linear-gradient(180deg, transparent, rgba(50,30,10,.55) 20%, rgba(50,30,10,.55) 80%, transparent); }
.foldB{ left:0; right:0; top:52%; height:2px; background:linear-gradient(90deg, transparent, rgba(50,30,10,.45) 20%, rgba(50,30,10,.45) 80%, transparent); }
.curl{
  position:absolute; right:-2px; bottom:-2px; width:70px; height:70px; z-index:3; pointer-events:none;
  background:linear-gradient(135deg, transparent 45%, rgba(150,110,60,.9) 46%, rgba(200,170,120,.95) 52%, rgba(90,60,30,.55) 60%, transparent 62%);
  filter:drop-shadow(-3px -3px 4px rgba(0,0,0,.45));
}
.stain{ position:absolute; border-radius:50%; pointer-events:none; opacity:.4; filter:blur(6px); background:radial-gradient(circle, rgba(60,35,12,.6), transparent 70%); }
.s1{ width:120px; height:90px; top:6%; right:8%; }
.s2{ width:90px; height:70px; bottom:10%; left:4%; }
.s3{ width:60px; height:60px; bottom:30%; right:2%; opacity:.25; }
.s4{ width:150px; height:110px; top:38%; left:-4%; opacity:.2; filter:blur(9px); }
.s5{ width:70px; height:70px; top:14%; left:22%; opacity:.16; filter:blur(5px); }

.bloodStain{
  position:absolute; top:18%; right:12%; width:48px; height:38px; border-radius:60% 40% 55% 45%;
  background:radial-gradient(circle at 40% 40%, rgba(110,20,15,.38), transparent 70%);
  filter:blur(4px); opacity:.55; pointer-events:none; z-index:1;
}

.content{ position:relative; z-index:2; color:#2a1c0e; }
.markRow{ display:flex; justify-content:center; margin-bottom:6px; }
.hairline{ height:1px; width:82%; margin:0 auto 16px; background:linear-gradient(90deg, transparent, rgba(60,35,12,.6), transparent); }

.heading{
  font-family:'Cormorant Garamond', Georgia, serif; font-weight:500; font-style:italic;
  font-size:27px; line-height:1.18; text-align:center; color:#24180c; margin:0 0 10px;
}
.headingSoft{ opacity:.72; }
.subheading{
  font-family:'Cormorant Garamond', Georgia, serif; font-style:italic; font-size:16px;
  text-align:center; color:#42301c; line-height:1.5; margin:0 0 10px;
}
.subheading .soft{ opacity:.75; color:#6a2818; }
.poemDivider{ text-align:center; color:rgba(60,35,12,.5); font-size:11px; letter-spacing:.3em; margin-bottom:14px; }
.sectionDivider{ text-align:center; color:rgba(60,35,12,.4); font-size:10.5px; letter-spacing:.28em; margin:16px 0; }

.letterForm{ position:relative; }
.letterInner{ transition:opacity 380ms ease, filter 380ms ease, transform 500ms cubic-bezier(.4,.1,.2,1); transform-origin:top center; }

.phase-folding .letterInner{ transform:scaleY(.55) scaleX(.96) rotateX(12deg); opacity:.7; filter:blur(.4px); }
.phase-sealing .letterInner,
.phase-sealed .letterInner{ opacity:0; filter:blur(2px); transform:scaleY(.4) scaleX(.9); pointer-events:none; }

.letterHead{ display:flex; align-items:baseline; justify-content:space-between; margin-bottom:8px; }
.dearLine{ font-family:'Cormorant Garamond', serif; font-size:21px; font-weight:500; color:#24180c; }
.wordCounter{
  font-size:11px;
  letter-spacing:0.04em;
  color:#4a3218;
  opacity:0.92;
}

.writeArea{ position:relative; margin-bottom:6px; }
.writeArea::before{
  content:"";
  position:absolute; left:38px; top:2px; bottom:8px; width:1px;
  background:linear-gradient(180deg, transparent, rgba(130,35,25,.35) 8%, rgba(130,35,25,.35) 92%, transparent);
  pointer-events:none;
}
textarea{
  width:100%; height:220px; resize:none; outline:none; border:none; border-radius:0;
  background:transparent;
  background-image:repeating-linear-gradient(transparent, transparent 33px, rgba(45,28,10,.28) 34px);
  color:#26180c; font-family:'Caveat', 'Cormorant Garamond', serif; font-weight:600; font-size:26px; line-height:34px;
  padding:6px 44px 10px 48px;
  caret-color:#8a2418;
  text-shadow:
    0 0 0.5px rgba(38,24,12,.65),
    0.3px 0.3px 0.7px rgba(38,24,12,.4),
    0 0 3px rgba(38,24,12,.18);
  transition:filter 180ms ease;
}
textarea.justTyped{ animation:inkSettle 260ms ease-out; }
@keyframes inkSettle{
  0%{ text-shadow:0 0 0.5px rgba(38,24,12,.65), 0.3px 0.3px 0.7px rgba(38,24,12,.4), 0 0 6px rgba(38,24,12,.32); }
  100%{ text-shadow:0 0 0.5px rgba(38,24,12,.65), 0.3px 0.3px 0.7px rgba(38,24,12,.4), 0 0 3px rgba(38,24,12,.18); }
}
textarea::placeholder{
  color:rgba(45,28,12,0.55);
  font-style:italic;
  font-family:'Cormorant Garamond', serif;
  font-size:18px;
  text-shadow:none;
}
textarea:focus{ filter:brightness(1.02); }
textarea.invalid{ animation:shake 320ms ease; }
textarea:disabled{ opacity:.7; }
.restingQuill{ position:absolute; right:-6px; bottom:-8px; width:22px; height:50px; opacity:.85; transform:rotate(18deg); pointer-events:none; }
.hint{
  min-height:14px;
  font-size:11.5px;
  color:#4a2e14;
  margin-top:2px;
  opacity:0.95;
}
.hint.error{ color:#9a2418; opacity:1; }

.fieldsRow{ display:grid; grid-template-columns:1fr 1fr; gap:22px; margin-bottom:4px; }
.field{ display:flex; flex-direction:column; gap:6px; }
.fieldLabel{ font-family:'Cormorant Garamond', serif; font-style:italic; font-size:14.5px; color:#3e2a16; }
.fieldInline{ display:flex; gap:14px; }

.lineInput{
  flex:1; background:transparent; border:none;
  border-bottom:1.5px solid rgba(55,32,12,.55);
  border-radius:0;
  padding:5px 2px 7px;
  color:#26180c;
  font-family:'Caveat', 'Cormorant Garamond', serif;
  font-size:18px;
  font-weight:600;
  outline:none;
  color-scheme:dark;
  transition:border-color 180ms ease, box-shadow 180ms ease, color 180ms ease;
  letter-spacing:0.02em;
}
.lineInput.fullWidth{ width:100%; }
.lineInput::placeholder{ color:rgba(45,28,12,.4); font-style:italic; font-weight:500; }
.lineInput:focus{
  border-color:#7a3a1c;
  box-shadow:0 1.5px 0 0 #7a3a1c;
  color:#1e1208;
}
.lineInput.invalid{ border-color:#9a2418; animation:shake 320ms ease; }
.lineInput:disabled{ opacity:.65; }

.lineInput[type="date"]::-webkit-calendar-picker-indicator,
.lineInput[type="time"]::-webkit-calendar-picker-indicator{
  opacity:0.45;
  cursor:pointer;
  filter:invert(0.3) sepia(0.4);
}

.caption{
  font-size:11px;
  color:#3e2814;
  opacity:0.92;
  line-height:1.35;
}
.caption.error{ color:#9a2418; opacity:1; }
.hint, .caption{ min-height:13px; }

@keyframes shake{0%,100%{transform:translateX(0);}25%{transform:translateX(-4px);}75%{transform:translateX(4px);}}

.ctaRow{ display:flex; justify-content:center; margin-top:2px; margin-bottom:10px; }

.sealButton{
  position:relative; width:240px; height:110px; border-radius:10px;
  border:2px solid #5a3018;
  background:
    linear-gradient(180deg, rgba(255,255,255,.05), transparent 40%),
    linear-gradient(180deg, #26150c, #100804 60%, #080402);
  display:flex; flex-direction:column; align-items:center; justify-content:center; gap:6px;
  padding:14px 10px 12px;
  cursor:pointer;
  box-shadow:
    inset 0 1px 0 rgba(200,140,80,.1),
    inset 0 -2px 4px rgba(0,0,0,.7),
    0 10px 24px rgba(0,0,0,.65);
  transition:box-shadow 280ms ease, transform 150ms ease, border-color 280ms ease;
  overflow:hidden;
}
.sealButton::before, .sealButton::after{
  content:""; position:absolute; top:5px; bottom:5px; width:1px;
  background:linear-gradient(180deg, transparent, rgba(140,60,30,.4), transparent);
}
.sealButton::before{ left:9px; } .sealButton::after{ right:9px; }
.sealButton:hover:not(:disabled){
  box-shadow:
    inset 0 1px 0 rgba(200,140,80,.15),
    inset 0 -2px 4px rgba(0,0,0,.7),
    0 0 34px rgba(180,50,25,.5),
    0 10px 24px rgba(0,0,0,.65);
  border-color:#902818;
}
.sealButton:active:not(:disabled){ transform:translateY(1px) scale(.99); }
.sealButton:disabled{ opacity:.8; cursor:default; }

.sealStack{ display:flex; flex-direction:column; align-items:center; gap:5px; position:relative; z-index:1; }
.sealCircle{
  width:36px; height:36px; border-radius:50%;
  display:flex; align-items:center; justify-content:center;
  background:radial-gradient(circle at 35% 30%, #902018, #3a0c06 78%);
  color:#d0c090; font-size:14px;
  box-shadow:0 0 0 2px rgba(140,50,30,.4), 0 2px 5px rgba(0,0,0,.6);
  transition:transform 240ms ease, box-shadow 280ms ease, border-radius 240ms ease;
}
.sealButton:hover:not(:disabled) .sealCircle{
  transform:scaleY(.86) scaleX(1.1);
  border-radius:48% 48% 52% 52%;
  box-shadow:0 0 18px 4px rgba(180,40,20,.8), 0 0 0 2px rgba(200,60,30,.65);
}
.sealCaption{
  font-family:'Cinzel', serif; font-size:8.5px; letter-spacing:.22em; text-transform:uppercase;
  color:rgba(170,140,100,.5);
}
.sealText{
  font-family:'Cinzel', serif; font-size:12px; letter-spacing:.14em; text-transform:uppercase;
  color:#c0a878;
  text-shadow:0 1px 0 rgba(0,0,0,.7), 0 -1px 0 rgba(200,160,100,.06);
}

.ctaEmbers{ position:absolute; inset:0; pointer-events:none; overflow:visible; }
.ctaEmber{
  position:absolute; top:-6px; width:3px; height:3px; border-radius:50%;
  background:#d06028; box-shadow:0 0 6px rgba(180,70,25,.7);
  opacity:0;
}
.sealButton:hover .ctaEmber{ animation:ctaEmberFall 1100ms ease-in forwards; }
@keyframes ctaEmberFall{
  0%{ transform:translateY(0); opacity:0; }
  15%{ opacity:1; }
  100%{ transform:translateY(64px); opacity:0; }
}

.lockCaption{
  text-align:center;
  font-size:11.5px;
  color:#3a2410;
  letter-spacing:0.02em;
  margin-top:6px;
  opacity:0.92;
}
.lockIcon{ opacity:0.85; margin-right:4px; }

.waxDrop{ position:absolute; left:50%; top:64%; transform:translateX(-50%); z-index:6; pointer-events:none; }
.waxBlob{
  display:block; width:34px; height:34px; border-radius:50%;
  background:radial-gradient(circle at 35% 30%, #8a2014, #3a0c06 75%);
  box-shadow:0 4px 10px rgba(0,0,0,.6);
  animation:waxFall 480ms cubic-bezier(.5,0,.8,1) forwards;
}
@keyframes waxFall{
  0%{ transform:translateY(-90px) scale(.6); opacity:0; }
  60%{ opacity:1; }
  100%{ transform:translateY(0) scale(1); opacity:1; }
}

.sealedOverlay{
  position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center;
  text-align:center; gap:12px; opacity:0; pointer-events:none; transition:opacity 500ms ease;
}
.sealedOverlay.show{ opacity:1; pointer-events:auto; }
.bigWax{
  width:70px; height:70px; border-radius:50%;
  background:radial-gradient(circle at 35% 30%, #8a2014, #3a0c06 75%);
  display:flex; align-items:center; justify-content:center;
  box-shadow:0 8px 18px rgba(0,0,0,.6), inset 0 0 10px rgba(0,0,0,.55);
  opacity:0; transform:scale(2.4) rotate(-14deg);
}
.sealedOverlay.show .bigWax{ animation:stamp 620ms cubic-bezier(.2,.9,.25,1.1) 80ms forwards; }
.bigWaxInner{ color:#d0c090; font-size:22px; opacity:.85; }
@keyframes stamp{0%{opacity:0;transform:scale(2.6) rotate(-16deg);}60%{opacity:1;transform:scale(.9) rotate(2deg);}100%{opacity:1;transform:scale(1) rotate(0);}}
.sealedTitle{ font-family:'Cormorant Garamond', serif; font-style:italic; font-weight:500; font-size:23px; line-height:1.3; color:#24180c; opacity:0; transform:translateY(6px); }
.sealedOverlay.show .sealedTitle{ animation:rise 700ms ease 380ms forwards; }
.sealedBody{ font-family:'Cormorant Garamond', serif; font-style:italic; font-size:15.5px; color:#3e2a16; max-width:380px; line-height:1.6; opacity:0; margin:0; }
.sealedOverlay.show .sealedBody{ animation:rise 700ms ease 600ms forwards; }
.sealedMeta{
  font-size:12px;
  color:#322010;
  opacity:0.94;
  letter-spacing:0.01em;
  max-width:90%;
  line-height:1.4;
}
.sealedOverlay.show .sealedMeta{ animation:rise 700ms ease 760ms forwards; }
.writeAnother{ margin-top:4px; background:none; border:none; color:#6a2e18; font-family:'IBM Plex Mono', monospace; font-size:11.5px; text-decoration:underline; text-underline-offset:3px; cursor:pointer; opacity:0; }
.sealedOverlay.show .writeAnother{ animation:rise 700ms ease 900ms forwards; }
@keyframes rise{ to{ opacity:1; transform:translateY(0); } }

.riseEmbers{ position:absolute; inset:0; overflow:hidden; pointer-events:none; }
.riseEmber{
  position:absolute; bottom:8%; width:3px; height:3px; border-radius:50%;
  background:#a04820; box-shadow:0 0 8px rgba(150,50,20,.6);
  opacity:0;
  animation:riseE 2.4s ease-out infinite;
}
@keyframes riseE{
  0%{ opacity:0; transform:translateY(0) scale(1); }
  12%{ opacity:.85; }
  100%{ opacity:0; transform:translateY(-180px) scale(.3); }
}

/* ---------- Glass Bottle (image) ---------- */
.glassBottle {
  position: absolute;
  right: 1.5%;
  bottom: 10%;
  width: 120px;
  height: auto;
  padding: 0;
  border: none;
  background: transparent;
  cursor: pointer;
  z-index: 15;
  transition: transform 380ms ease, filter 380ms ease;
  pointer-events: auto;
  filter: drop-shadow(0 10px 18px rgba(0, 0, 0, 0.6));
}

.glassBottle:hover:not(:disabled) {
  transform: translateY(-12px) scale(1.06);
  filter:
    drop-shadow(0 16px 26px rgba(0, 0, 0, 0.65))
    drop-shadow(0 0 14px rgba(220, 140, 50, 0.3));
}

.glassBottle:active:not(:disabled) {
  transform: translateY(-5px) scale(1.02);
}

.glassBottle:disabled {
  cursor: default;
  opacity: 0.65;
}

.bottleImg {
  width: 100%;
  height: auto;
  display: block;
  pointer-events: none;
  user-select: none;
}

.glassBottle.rising {
  animation: bottleRise 1.8s ease-in-out forwards;
  pointer-events: none;
}

@keyframes bottleRise {
  0%   { transform: translateY(0) rotate(0deg) scale(1); opacity: 1; }
  35%  { transform: translateY(-48px) rotate(-14deg) scale(1.08); opacity: 1; }
  70%  { transform: translateY(-28px) rotate(8deg) scale(1.03); opacity: 0.85; }
  100% { transform: translateY(-180px) rotate(0deg) scale(0.85); opacity: 0; }
}

@media (max-width: 980px) {
  .glassBottle {
    right: 16px;
    bottom: 28px;
    width: 88px;
  }
}

/* ---------- Journey Modal ---------- */
.journeyOverlay {
  position: fixed;
  inset: 0;
  z-index: 120;
  background: rgba(0, 0, 4, 0.72);
  display: flex;
  align-items: center;
  justify-content: center;
  backdrop-filter: blur(4px) saturate(0.85);
  animation: overlayIn 500ms ease forwards;
}

@keyframes overlayIn {
  from { opacity: 0; }
  to   { opacity: 1; }
}

/* stronger vignette while modal is open */
.journeyOverlay::before {
  content: "";
  position: absolute;
  inset: 0;
  background: radial-gradient(
    ellipse 70% 65% at 50% 45%,
    transparent 30%,
    rgba(0, 0, 0, 0.55) 100%
  );
  pointer-events: none;
}

.journeyModal {
  position: relative;
  background:
    radial-gradient(120% 90% at 20% 0%, rgba(240, 220, 180, 0.35), transparent 55%),
    linear-gradient(155deg, #d4b888 0%, #c09a60 45%, #a88050 100%);
  padding: 44px 48px 36px;
  max-width: 520px;
  width: 92%;
  border-radius: 3px;
  box-shadow:
    0 40px 100px rgba(0, 0, 0, 0.75),
    0 12px 30px rgba(0, 0, 0, 0.4),
    inset 0 0 60px rgba(255, 255, 255, 0.06);
  text-align: center;
  transform-origin: center 20%;
  animation: parchmentUnfold 780ms cubic-bezier(0.22, 0.8, 0.28, 1) forwards;
}

@keyframes parchmentUnfold {
  0% {
    opacity: 0;
    transform: translateY(36px) rotateX(-11deg) scale(0.96);
    filter: brightness(0.92);
  }
  55% {
    opacity: 1;
    transform: translateY(-3px) rotateX(1.5deg) scale(1.01);
    filter: brightness(1.03);
  }
  100% {
    opacity: 1;
    transform: translateY(0) rotateX(0deg) scale(1);
    filter: brightness(1);
  }
}

.journeyTitle {
  font-family: 'Cormorant Garamond', serif;
  font-size: 26px;
  font-style: italic;
  color: #2a1c0e;
  margin-bottom: 32px;
  letter-spacing: 0.01em;
}

/* Physical choice cards */
.journeyChoice {
  display: block;
  width: 100%;
  background:
    linear-gradient(165deg, rgba(255, 250, 235, 0.25), rgba(40, 22, 10, 0.04));
  border: 1.5px solid rgba(70, 40, 15, 0.38);
  border-radius: 2px;
  padding: 22px 24px;
  margin-bottom: 16px;
  cursor: pointer;
  text-align: left;
  position: relative;
  box-shadow:
    0 4px 12px rgba(0, 0, 0, 0.18),
    inset 0 1px 0 rgba(255, 255, 255, 0.15);
  transition:
    transform 280ms ease,
    box-shadow 280ms ease,
    border-color 280ms ease,
    background 280ms ease;
}

.journeyChoice:hover {
  transform: translateY(-4px);
  border-color: rgba(160, 90, 40, 0.55);
  background:
    linear-gradient(165deg, rgba(255, 245, 220, 0.35), rgba(60, 30, 10, 0.06));
  box-shadow:
    0 14px 28px rgba(0, 0, 0, 0.28),
    0 0 0 1px rgba(200, 120, 50, 0.25),
    inset 0 1px 0 rgba(255, 255, 255, 0.22),
    0 0 24px rgba(220, 130, 50, 0.12); /* soft candle reflection */
}

.journeyChoice:active {
  transform: translateY(-1px);
}

.choiceTitle {
  display: block;
  font-family: 'Cinzel', serif;
  font-size: 15px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: #3a2410;
  margin-bottom: 9px;
}

.choiceDesc {
  font-family: 'Cormorant Garamond', serif;
  font-style: italic;
  font-size: 15.5px;
  color: #5a3a1c;
  line-height: 1.5;
}

.journeyCancel {
  margin-top: 22px;
  background: none;
  border: none;
  font-family: 'IBM Plex Mono', monospace;
  font-size: 12px;
  color: #7a4a28;
  text-decoration: underline;
  text-underline-offset: 3px;
  cursor: pointer;
  opacity: 0.85;
  transition: opacity 200ms ease;
}
.journeyCancel:hover {
  opacity: 1;
}

/* ---------- Reading mode – handled parchment ---------- */
.readingOverlay,
.journeyOverlay {
  cursor: auto !important;
}
.readingOverlay *,
.journeyOverlay * {
  cursor: auto;
}
.journeyOverlay .journeyChoice,
.journeyOverlay .journeyCancel,
.readingOverlay .readingClose {
  cursor: pointer !important;
}

.readingOverlay {
  position: fixed;
  inset: 0;
  z-index: 130;
  background: rgba(0, 0, 4, 0.88);
  display: flex;
  align-items: center;
  justify-content: center;
}

.readingParchment {
  position: relative;
  width: 560px;
  max-width: 92vw;
  padding: 48px 46px 42px;
  background:
    radial-gradient(90% 70% at 15% 10%, rgba(230, 210, 170, 0.35), transparent 55%),
    radial-gradient(70% 60% at 90% 90%, rgba(80, 45, 20, 0.28), transparent 60%),
    linear-gradient(158deg, #d0b480 0%, #bc9860 40%, #a88050 70%, #967048 100%);
  box-shadow:
    8px 28px 60px rgba(0, 0, 0, 0.55),
    -4px 12px 30px rgba(0, 0, 0, 0.35),
    inset 0 0 80px rgba(255, 255, 255, 0.04);
  transform: rotate(-1.6deg);
  overflow: hidden;
}

.readingParchment::after {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  background-image:
    repeating-linear-gradient(0deg, rgba(50, 32, 12, 0.04) 0 1px, transparent 1px 5px),
    repeating-linear-gradient(90deg, rgba(50, 32, 12, 0.03) 0 1px, transparent 1px 8px);
  mix-blend-mode: multiply;
  opacity: 0.7;
}

.rpBurn {
  position: absolute;
  border-radius: 50%;
  pointer-events: none;
  mix-blend-mode: multiply;
  filter: blur(4px);
}
.rpBurn1 {
  width: 70px;
  height: 55px;
  top: -8px;
  left: 18%;
  background: radial-gradient(circle, rgba(40, 18, 6, 0.55), transparent 70%);
}
.rpBurn2 {
  width: 45px;
  height: 40px;
  bottom: 12%;
  right: 8%;
  background: radial-gradient(circle, rgba(35, 14, 5, 0.45), transparent 70%);
}

.rpCoffee {
  position: absolute;
  width: 78px;
  height: 78px;
  top: 22%;
  right: 14%;
  border-radius: 50%;
  border: 3px solid rgba(90, 50, 20, 0.18);
  box-shadow: inset 0 0 8px rgba(90, 50, 20, 0.08);
  pointer-events: none;
  transform: rotate(12deg);
  opacity: 0.7;
}

.rpWax {
  position: absolute;
  width: 36px;
  height: 48px;
  bottom: 18%;
  left: 10%;
  background: radial-gradient(ellipse at 40% 30%, rgba(140, 30, 20, 0.35), transparent 70%);
  border-radius: 40% 50% 55% 45%;
  filter: blur(2px);
  pointer-events: none;
  opacity: 0.65;
}

.rpFold {
  position: absolute;
  pointer-events: none;
  mix-blend-mode: multiply;
  opacity: 0.28;
}
.rpFoldH {
  left: 8%;
  right: 8%;
  top: 48%;
  height: 1.5px;
  background: linear-gradient(90deg, transparent, rgba(50, 30, 10, 0.5) 20%, rgba(50, 30, 10, 0.5) 80%, transparent);
}
.rpFoldV {
  top: 10%;
  bottom: 10%;
  left: 62%;
  width: 1.5px;
  background: linear-gradient(180deg, transparent, rgba(50, 30, 10, 0.45) 15%, rgba(50, 30, 10, 0.45) 85%, transparent);
}

.rpCurl {
  position: absolute;
  right: -2px;
  bottom: -2px;
  width: 64px;
  height: 64px;
  background: linear-gradient(
    135deg,
    transparent 42%,
    rgba(150, 110, 60, 0.85) 46%,
    rgba(200, 170, 120, 0.9) 52%,
    rgba(90, 60, 30, 0.5) 60%,
    transparent 64%
  );
  filter: drop-shadow(-2px -2px 3px rgba(0, 0, 0, 0.35));
  pointer-events: none;
  z-index: 2;
}

.rpFade {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background:
    radial-gradient(120px 100px at 0% 0%, rgba(20, 10, 4, 0.2), transparent 70%),
    radial-gradient(100px 90px at 100% 0%, rgba(20, 10, 4, 0.16), transparent 70%),
    radial-gradient(110px 100px at 0% 100%, rgba(20, 10, 4, 0.18), transparent 70%);
}

.readingHeader {
  position: relative;
  z-index: 1;
  font-family: 'Cormorant Garamond', serif;
  font-style: italic;
  font-size: 20px;
  color: #4a3018;
  text-align: center;
  margin-bottom: 26px;
  opacity: 0.92;
}

.readingBody {
  position: relative;
  z-index: 1;
  font-family: 'Caveat', serif;
  font-size: 26px;
  line-height: 1.55;
  color: #2a1c0e;
  min-height: 160px;
  text-shadow: 0.3px 0.3px 0.6px rgba(38, 24, 12, 0.3);
}

.readingMeta {
  position: relative;
  z-index: 1;
  margin-top: 30px;
  font-family: 'Cormorant Garamond', serif;
  font-style: italic;
  color: #5a3a1c;
  text-align: right;
  opacity: 0.9;
}

.readingClose {
  position: relative;
  z-index: 1;
  display: block;
  margin: 34px auto 0;
  background: none;
  border: none;
  font-family: 'IBM Plex Mono', monospace;
  font-size: 12px;
  color: #7a3a20;
  text-decoration: underline;
  text-underline-offset: 3px;
  cursor: pointer !important;
}

.footerQuote{
  position:absolute; left:0; right:0; bottom:16px; z-index:6; text-align:center;
  font-family:'Cormorant Garamond', serif; font-style:italic; font-size:13px; letter-spacing:.04em;
  color:rgba(160,140,110,.4);
}

/* Ensure interactive elements receive clicks */
.rightWrap, .parchment, .letterForm, .sealButton, .lineInput, textarea, .writeAnother, .field, .content, .glassBottle, .journeyChoice, .journeyCancel, .readingClose {
  pointer-events: auto;
}

@media (max-width:980px){
  .leftScene{ position:relative; right:auto; height:46vh; min-height:280px; }
  .rightWrap{ padding:24px 16px 48px; }
  .rightWrap::before{ display:none; }
  .stage{ display:flex; flex-direction:column; }
  .fieldsRow{ grid-template-columns:1fr; }
  .footerQuote{ position:relative; bottom:auto; padding:16px; }
  .vignette{ background:radial-gradient(ellipse 90% 80% at 50% 40%, transparent 35%, rgba(0,0,0,.5) 100%); }
  .glassBottle{ right:16px; bottom:28px; width:88px; }
}

:focus-visible{ outline:2px solid rgba(180,80,40,.7); outline-offset:2px; }
@media (prefers-reduced-motion: reduce){ 
  *{ animation-duration:.001ms !important; animation-iteration-count:1 !important; transition-duration:.001ms !important; }
  .stage.breathing{ animation:none; }
}
`;