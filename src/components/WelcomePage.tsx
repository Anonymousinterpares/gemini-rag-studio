import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';

interface WelcomePageProps {
  onEnter: () => void;
  videoDone: boolean;
  setVideoDone: (done: boolean) => void;
}

interface Bolt {
  main: { x: number, y: number }[];
  branches: { x: number, y: number }[][];
  born: number;
  life: number;
}

interface LogoBolt {
  points: { x: number, y: number }[];
  born: number;
  life: number;
  width: number;
}

// --- Button Electric System ---
const ButtonElectric = (() => {
  let bolts: Bolt[] = [];
  let lastSpawn = 0;
  const rand = (a: number, b: number) => a + Math.random() * (b - a);

  function perimeter(W: number, H: number) {
    const p = Math.random() * 2 * (W + H);
    if (p < W) return { x: p, y: 0 };
    if (p < W + H) return { x: W, y: p - W };
    if (p < 2 * W + H) return { x: W - (p - W - H), y: H };
    return { x: 0, y: H - (p - 2 * W - H) };
  }

  function segment(x1: number, y1: number, x2: number, y2: number, rough: number, depth: number): {x: number, y: number}[] {
    if (depth <= 0) return [{ x: x1, y: y1 }, { x: x2, y: y2 }];
    const mx = (x1 + x2) * 0.5 + (Math.random() - 0.5) * rough;
    const my = (y1 + y2) * 0.5 + (Math.random() - 0.5) * rough;
    return [
      ...segment(x1, y1, mx, my, rough * 0.58, depth - 1),
      ...segment(mx, my, x2, y2, rough * 0.58, depth - 1),
    ];
  }

  function spawnBolt(W: number, H: number): Bolt {
    const p1 = perimeter(W, H), p2 = perimeter(W, H);
    const rough = Math.min(W, H) * (0.18 + Math.random() * 0.28);
    const main = segment(p1.x, p1.y, p2.x, p2.y, rough, 5);
    const branches = [];
    const nb = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < nb; i++) {
      const idx = Math.floor(main.length * (0.25 + Math.random() * 0.5));
      const pt = main[idx];
      const ang = Math.atan2(p2.y - p1.y, p2.x - p1.x) + rand(-1.2, 1.2);
      const len = rand(12, 40);
      branches.push(segment(pt.x, pt.y, pt.x + Math.cos(ang) * len, pt.y + Math.sin(ang) * len, len * 0.4, 3));
    }
    return { main, branches, born: performance.now(), life: rand(160, 320) };
  }

  function drawPath(ctx: CanvasRenderingContext2D, path: { x: number, y: number }[], alpha: number, coreW: number, colRgb: string, glowBlur: number) {
    if (path.length < 2) return;
    ctx.save();
    ctx.globalAlpha = alpha * 0.55;
    ctx.strokeStyle = `rgba(${colRgb},1)`;
    ctx.lineWidth = coreW * 4;
    ctx.lineCap = ctx.lineJoin = 'round';
    ctx.shadowColor = `rgba(${colRgb},1)`;
    ctx.shadowBlur = glowBlur * 2.5;
    ctx.beginPath(); ctx.moveTo(path[0].x, path[0].y);
    for (let i = 1; i < path.length; i++) ctx.lineTo(path[i].x, path[i].y);
    ctx.stroke();
    
    ctx.globalAlpha = alpha * 0.75;
    ctx.strokeStyle = `rgba(200,225,255,1)`;
    ctx.lineWidth = coreW * 1.8;
    ctx.shadowBlur = glowBlur;
    ctx.beginPath(); ctx.moveTo(path[0].x, path[0].y);
    for (let i = 1; i < path.length; i++) ctx.lineTo(path[i].x, path[i].y);
    ctx.stroke();
    
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = 'rgba(255,255,255,1)';
    ctx.lineWidth = coreW;
    ctx.shadowBlur = 0;
    ctx.beginPath(); ctx.moveTo(path[0].x, path[0].y);
    for (let i = 1; i < path.length; i++) ctx.lineTo(path[i].x, path[i].y);
    ctx.stroke();
    ctx.restore();
  }

  return {
    render(ctx: CanvasRenderingContext2D, W: number, H: number, mouseX: number, mouseY: number) {
      const now = performance.now();
      if (now - lastSpawn > rand(65, 145)) {
        bolts.push(spawnBolt(W, H));
        lastSpawn = now;
      }
      bolts = bolts.filter(b => now - b.born < b.life);

      const coA = Math.min(0.55, bolts.length * 0.14);
      if (coA > 0.01) {
        const cg = ctx.createRadialGradient(mouseX, mouseY, 0, mouseX, mouseY, Math.max(W, H) * 0.75);
        cg.addColorStop(0, `rgba(100,160,255,${(coA * 0.35).toFixed(2)})`);
        cg.addColorStop(0.35, `rgba(60,100,220,${(coA * 0.18).toFixed(2)})`);
        cg.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = cg;
        ctx.beginPath();
        if ('roundRect' in ctx) {
            (ctx as unknown as { roundRect: (x: number, y: number, w: number, h: number, r: number) => void }).roundRect(0, 0, W, H, H / 2);
        } else {
            ctx.rect(0, 0, W, H);
        }
        ctx.fill();
      }

      for (const b of bolts) {
        const age = (now - b.born) / b.life;
        const alpha = age < 0.12 ? age / 0.12 : 1 - ((age - 0.12) / 0.88);
        drawPath(ctx, b.main, alpha, 1.3, '120,180,255', 10);
        for (const br of b.branches) drawPath(ctx, br, alpha * 0.55, 0.7, '100,160,255', 6);
      }
    },
    reset() { bolts = []; }
  };
})();

// --- Logo Electric System (Syne RAG) ---
const LogoElectric = {
  bolts: [] as LogoBolt[],
  lastSpawn: 0,
  createFractalPoints(x1: number, y1: number, x2: number, y2: number, depth = 4) {
    let pts = [{x: x1, y: y1}, {x: x2, y: y2}];
    for(let i=0; i<depth; i++) {
      const next = [];
      for(let j=0; j<pts.length-1; j++) {
        const p1 = pts[j], p2 = pts[j+1];
        const mx = (p1.x + p2.x)/2, my = (p1.y + p2.y)/2;
        const dist = Math.sqrt((p2.x-p1.x)**2 + (p2.y-p1.y)**2);
        const angle = Math.atan2(p2.y-p1.y, p2.x-p1.x) + Math.PI/2;
        const offset = (Math.random()-0.5) * dist * 0.6;
        next.push(p1, { x: mx + Math.cos(angle)*offset, y: my + Math.sin(angle)*offset });
      }
      next.push(pts[pts.length-1]);
      pts = next;
    }
    return pts;
  },
  render(ctx: CanvasRenderingContext2D, textBounds: { x: number, y: number, w: number, h: number }) {
    const now = performance.now();
    if (now - this.lastSpawn > 60 && textBounds) {
      const x1 = textBounds.x + Math.random() * textBounds.w;
      const y1 = textBounds.y + Math.random() * textBounds.h;
      const x2 = x1 + (Math.random()-0.5) * 200;
      const y2 = y1 + (Math.random()-0.5) * 200;
      this.bolts.push({ points: this.createFractalPoints(x1, y1, x2, y2), born: now, life: 150 + Math.random() * 250, width: 1 + Math.random() * 2 });
      this.lastSpawn = now;
    }
    this.bolts = this.bolts.filter(b => now - b.born < b.life);
    ctx.save();
    this.bolts.forEach(b => {
      const alpha = 1 - (now - b.born)/b.life;
      ctx.beginPath();
      ctx.moveTo(b.points[0].x, b.points[0].y);
      for(let i=1; i<b.points.length; i++) ctx.lineTo(b.points[i].x, b.points[i].y);
      ctx.strokeStyle = `rgba(255, 255, 255, ${alpha})`;
      ctx.lineWidth = b.width;
      ctx.shadowBlur = 15;
      ctx.shadowColor = '#4d7fff';
      ctx.stroke();
    });
    ctx.restore();
  }
};

export const WelcomePage: React.FC<WelcomePageProps> = ({ onEnter, videoDone, setVideoDone }) => {
  const [ready, setReady] = useState(false);
  const [showBtn, setShowBtn] = useState(false);
  
  const logoCanvasRef = useRef<HTMLCanvasElement>(null);
  const btnCanvasRef = useRef<HTMLCanvasElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const pngSpacerRef = useRef<HTMLDivElement>(null);
  
  // Using refs for mutable state that doesn't need to trigger re-renders
  // This is CRITICAL to prevent the animation loops from tearing down and restarting
  const mousePosRef = useRef({ x: 0, y: 0 });
  const isHoveringBtnRef = useRef(false);
  
  const [ragImage, setRagImage] = useState<HTMLImageElement | null>(null);

  useEffect(() => {
    const img = new Image();
    img.src = '/assets/RAG.png';
    img.onload = () => setRagImage(img);
  }, []);

  useEffect(() => {
    if (videoDone) {
      setReady(true);
    }
  }, [videoDone]);

  // Timers for sequential appearance
  useEffect(() => {
    if (ready) {
      // 1. RAG Logo takes 1.5s to fully appear.
      // 2. Studio text starts fading in at 1.5s (via motion.div delay) and takes 1.5s.
      // 3. Button should appear only AFTER Studio text is visible (at 3.0s).
      const timer = setTimeout(() => setShowBtn(true), 3000);
      return () => clearTimeout(timer);
    }
  }, [ready]);

  // Logo Animation Loop (Strictly decoupled from Button state)
  useEffect(() => {
    if (ready && logoCanvasRef.current && ragImage) {
      const cvs = logoCanvasRef.current;
      const ctx = cvs.getContext('2d', { alpha: true });
      if (!ctx) return;
      
      let raf: number;
      const startTime = performance.now();
      
      const draw = () => {
        const now = performance.now();
        const W = window.innerWidth, H = window.innerHeight;
        
        if (cvs.width !== W || cvs.height !== H) { cvs.width = W; cvs.height = H; }
        ctx.clearRect(0, 0, W, H);
        
        // 1500ms smooth fade-in curve (NEVER resets once started)
        const alpha = Math.min(1, Math.max(0, (now - startTime) / 1500));
        ctx.globalAlpha = alpha;
        
        // Sync drawing with DOM spacer position
        if (pngSpacerRef.current) {
            const rect = pngSpacerRef.current.getBoundingClientRect();
            const tx = rect.left;
            const ty = rect.top;
            const targetW = rect.width;
            const targetH = rect.height;

            ctx.save();
            ctx.shadowBlur = 40; ctx.shadowColor = 'rgba(28, 69, 233, 0.8)';
            ctx.drawImage(ragImage, tx, ty, targetW, targetH);
            ctx.shadowBlur = 5; ctx.shadowColor = '#709bff';
            ctx.drawImage(ragImage, tx, ty, targetW, targetH);
            ctx.globalCompositeOperation = 'source-atop';
            LogoElectric.render(ctx, { x: tx, y: ty, w: targetW, h: targetH });
            ctx.restore();
        }

        raf = requestAnimationFrame(draw);
      };
      
      raf = requestAnimationFrame(draw);
      return () => cancelAnimationFrame(raf);
    }
  }, [ready, ragImage]);

  // Button Animation Loop (Strictly decoupled from Logo state)
  useEffect(() => {
    if (showBtn && btnCanvasRef.current) {
      const cvs = btnCanvasRef.current;
      const ctx = cvs.getContext('2d');
      if (!ctx) return;
      
      const resize = () => {
        if (btnRef.current) {
          cvs.width = btnRef.current.offsetWidth;
          cvs.height = btnRef.current.offsetHeight;
        }
      };
      resize();
      const ro = new ResizeObserver(resize);
      if (btnRef.current) ro.observe(btnRef.current);

      let raf: number;
      const loop = () => {
        const W = cvs.width, H = cvs.height;
        ctx.clearRect(0, 0, W, H);
        if (isHoveringBtnRef.current) {
          ButtonElectric.render(ctx, W, H, mousePosRef.current.x, mousePosRef.current.y);
        }
        raf = requestAnimationFrame(loop);
      };
      loop();
      return () => { cancelAnimationFrame(raf); ro.disconnect(); };
    }
  }, [showBtn]);

  const handleBtnMouseMove = useCallback((e: React.MouseEvent) => {
    if (btnRef.current) {
        const rect = btnRef.current.getBoundingClientRect();
        mousePosRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }
  }, []);

  return (
    <div className="welcome-page-container">
      <style>{`
        .welcome-page-container {
            width: 100vw;
            height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            overflow: hidden;
            background: transparent;
            z-index: 1000;
            position: relative;
        }
        .content-column {
            display: flex;
            flex-direction: column;
            align-items: center;
            position: relative;
            z-index: 30;
            width: 100%;
        }
        .png-spacer {
            width: 75vw;
            max-width: 1200px;
            aspect-ratio: 4.5 / 1; /* Approximate from RAG.png aspect */
            visibility: hidden;
            margin-top: -10vh; /* Adjust vertical center of the whole stack */
        }
        .studio-logo {
          margin-top: 20px; /* Gap below PNG */
          --glow-inner-opacity: 0.8;
          --glow-outer-opacity: 0.5;
          text-shadow: 0 0 30px rgba(255, 215, 0, var(--glow-inner-opacity)), 
                       0 0 60px rgba(255, 215, 0, var(--glow-outer-opacity));
          font-family: 'Outfit', sans-serif;
          font-weight: 300;
          font-size: clamp(35px, 6vw, 85px);
          color: #FFD700;
          letter-spacing: 0.25em;
          text-transform: uppercase;
          will-change: transform, opacity;
        }
        .button-wrapper {
            margin-top: 3em; /* 3 heights of studio text */
            height: 100px;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .enter-btn {
          font-family: 'Outfit', sans-serif;
          font-weight: 400;
          font-size: 18px;
          letter-spacing: 0.09em;
          padding: 20px 60px;
          border-radius: 100px;
          background: rgba(28, 69, 233, 0.2);
          border: 2px solid rgba(255, 255, 255, 0.34);
          color: #a52222; /* EXACT RED FROM HTML */
          cursor: pointer;
          position: relative;
          overflow: hidden;
          transition: all 0.3s cubic-bezier(0.2, 0.8, 0.2, 1);
          text-transform: uppercase;
          outline: none;
          --neon-glow: #1c45e9;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        @keyframes neon-pulse {
          0%, 100% { box-shadow: 0 0 15px var(--neon-glow), inset 0 0 5px var(--neon-glow); border-color: rgba(255,255,255,0.34); }
          50% { box-shadow: 0 0 30px var(--neon-glow), inset 0 0 10px var(--neon-glow); border-color: rgba(255,255,255,0.6); }
        }
        .animate-neon { animation: neon-pulse 2s ease-in-out infinite; }
        .enter-btn:active { transform: scale(0.97); }
        .logo-canvas {
            position: absolute;
            inset: 0;
            pointer-events: none;
            filter: drop-shadow(0 0 30px rgba(28, 69, 233, 0.4));
        }
      `}</style>
      
      {ready && (
        <>
          <canvas ref={logoCanvasRef} className="logo-canvas" />
          
          <div className="content-column">
            <div ref={pngSpacerRef} className="png-spacer" />
            
            {/* Using explicit inline styles to guarantee Flexbox vertical stacking regardless of Tailwind context */}
            <motion.div 
                initial={{ opacity: 0, y: 30 }} 
                animate={{ opacity: 1, y: 0 }} 
                transition={{ duration: 1.5, ease: "easeOut", delay: 1.5 }} // delayed until RAG finishes
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}
            >
                <span className="studio-logo">Studio</span>

                <div className="button-wrapper">
                    {showBtn && (
                        <motion.button 
                        ref={btnRef}
                        initial={{ opacity: 0, scale: 0.8 }} 
                        animate={{ opacity: 1, scale: 1 }} 
                        transition={{ duration: 0.8, ease: "backOut" }}
                        className="enter-btn animate-neon"
                        onMouseEnter={() => { 
                            isHoveringBtnRef.current = true; 
                            if(btnCanvasRef.current) btnCanvasRef.current.style.opacity = '1'; 
                        }}
                        onMouseLeave={() => { 
                            isHoveringBtnRef.current = false; 
                            if(btnCanvasRef.current) btnCanvasRef.current.style.opacity = '0'; 
                            ButtonElectric.reset(); 
                        }}
                        onMouseMove={handleBtnMouseMove}
                        onClick={() => {
                            if (btnRef.current) {
                                btnRef.current.style.opacity = '0';
                                btnRef.current.style.transform = 'scale(2)';
                                btnRef.current.style.pointerEvents = 'none';
                            }
                            setTimeout(onEnter, 500);
                        }}
                        >
                        <canvas 
                            ref={btnCanvasRef} 
                            style={{ 
                                position: 'absolute', 
                                inset: 0, 
                                width: '100%', 
                                height: '100%',
                                borderRadius: '100px',
                                opacity: 0,
                                transition: 'opacity 0.2s'
                            }}
                        />
                        <span className="relative z-10">ENTER EXPERIENCE</span>
                        </motion.button>
                    )}
                </div>
            </motion.div>
          </div>
        </>
      )}
      {!ready && (
        <div className="z-50 text-[10px] tracking-[0.5em] text-blue-400/50 absolute bottom-10 uppercase animate-pulse" 
             style={{ position: 'absolute', bottom: '40px', left: '50%', transform: 'translateX(-50%)', zIndex: 50 }}>
          Initializing Core...
        </div>
      )}
    </div>
  );
};
