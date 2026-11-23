import { useEffect, useRef } from 'react';

const VERTEX_SHADER = `
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const FRAGMENT_SHADER = `
precision highp float;

varying vec2 vUv;
uniform float uTime;
uniform vec2 uPointer;
uniform float uAspect;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
  float value = 0.0;
  float amplitude = 0.5;
  mat2 rotation = mat2(0.80, 0.60, -0.60, 0.80);
  for (int i = 0; i < 4; i++) {
    value += amplitude * noise(p);
    p = rotation * p * 2.03 + 1.7;
    amplitude *= 0.5;
  }
  return value;
}

void main() {
  vec2 uv = vUv;
  vec2 p = vec2((uv.x - 0.5) * uAspect + 0.5, uv.y);
  float t = uTime * 0.02;
  vec2 pointer = vec2(uPointer.x, 1.0 - uPointer.y);
  pointer.x = (pointer.x - 0.5) * uAspect + 0.5;

  vec2 drift = vec2(t * 0.7, -t * 0.45);
  vec2 q = p * 2.6 + drift;
  vec2 warp = vec2(
    fbm(q + vec2(0.0, t * 1.3)),
    fbm(q + vec2(4.7, -t * 1.1))
  );
  float liquid = fbm(q + warp * 1.15);
  float edge = smoothstep(0.18, 0.82, liquid);
  float fresnel = pow(1.0 - smoothstep(0.0, 0.85, abs(p.y - 0.5) * 1.5), 1.6);
  float glow = exp(-distance(p, pointer) * 5.0);
  float caustic = pow(max(0.0, sin((p.x * 2.2 + liquid * 2.2) * 12.566 + t * 6.0)), 8.0);

  vec3 warm = vec3(1.0, 0.32, 0.10);
  vec3 violet = vec3(0.45, 0.24, 1.0);
  vec3 color = mix(violet, warm, edge) * (0.035 + fresnel * 0.075);
  color += warm * glow * 0.055;
  color += vec3(1.0, 0.75, 0.55) * caustic * 0.018;

  float alpha = (0.025 + fresnel * 0.06 + edge * 0.04 + glow * 0.025)
    * smoothstep(0.0, 0.18, uv.y);

  gl_FragColor = vec4(color, alpha);
}
`;

/**
 * GPU-driven liquid-glass light field. Three is loaded only when the desk is
 * opened, renders at a capped resolution, and pauses in hidden tabs.
 */
export function LiquidBackdrop({ className = '' }: { className?: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return;

    let disposed = false;
    let disposeScene: (() => void) | null = null;

    void import('three')
      .then((THREE) => {
        if (disposed) return;

        const renderer = (() => {
          try {
            return new THREE.WebGLRenderer({
              canvas,
              alpha: true,
              antialias: false,
              powerPreference: 'low-power',
            });
          } catch {
            return null;
          }
        })();
        if (!renderer) return;

        const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        const scene = new THREE.Scene();
        const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        const geometry = new THREE.PlaneGeometry(2, 2);
        const uniforms = {
          uTime: { value: 0 },
          uPointer: { value: new THREE.Vector2(0.5, 0.18) },
          uAspect: { value: 1 },
        };
        const material = new THREE.ShaderMaterial({
          uniforms,
          vertexShader: VERTEX_SHADER,
          fragmentShader: FRAGMENT_SHADER,
          transparent: true,
          depthTest: false,
          depthWrite: false,
        });
        const mesh = new THREE.Mesh(geometry, material);
        scene.add(mesh);

        renderer.setClearColor(0x000000, 0);
        renderer.setPixelRatio(1);

        const target = new THREE.Vector2(0.5, 0.18);
        const resize = () => {
          const rect = host.getBoundingClientRect();
          const width = Math.max(1, Math.round(rect.width));
          const height = Math.max(1, Math.round(rect.height));
          const maxWidth = window.innerWidth < 720 ? 620 : 1200;
          const scale = Math.min(1, maxWidth / width);
          renderer.setSize(
            Math.max(1, Math.round(width * scale)),
            Math.max(1, Math.round(height * scale)),
            false,
          );
          uniforms.uAspect.value = width / height;
          if (reduceMotion) renderer.render(scene, camera);
        };

        const onPointerMove = (event: PointerEvent) => {
          const rect = host.getBoundingClientRect();
          if (!rect.width || !rect.height) return;
          target.x = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
          target.y = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
        };

        const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize);
        observer?.observe(host);
        resize();

        let frame = 0;
        let lastPaint = 0;
        const clock = new THREE.Clock();

        const paint = (time: number) => {
          if (disposed) return;
          frame = window.requestAnimationFrame(paint);
          if (document.hidden || time - lastPaint < 33) return;
          lastPaint = time;
          const delta = Math.min(0.05, clock.getDelta());
          uniforms.uTime.value += delta;
          uniforms.uPointer.value.lerp(target, 0.045);
          renderer.render(scene, camera);
        };

        if (!reduceMotion) {
          window.addEventListener('pointermove', onPointerMove, { passive: true });
          frame = window.requestAnimationFrame(paint);
        }

        const onContextLost = (event: Event) => event.preventDefault();
        canvas.addEventListener('webglcontextlost', onContextLost);

        disposeScene = () => {
          window.cancelAnimationFrame(frame);
          window.removeEventListener('pointermove', onPointerMove);
          canvas.removeEventListener('webglcontextlost', onContextLost);
          observer?.disconnect();
          geometry.dispose();
          material.dispose();
          renderer.dispose();
        };
      })
      .catch(() => undefined);

    return () => {
      disposed = true;
      disposeScene?.();
    };
  }, []);

  return (
    <div ref={hostRef} className={`liquid-backdrop ${className}`.trim()} aria-hidden="true">
      <canvas ref={canvasRef} />
    </div>
  );
}
