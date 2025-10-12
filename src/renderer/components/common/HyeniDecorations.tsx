/**
 * 강혜니 일러스트 - 메인 캐릭터 (왼쪽 사이드바용)
 */
export function HyeniDecorations() {
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden flex items-end justify-center">
      {/* 메인 캐릭터 - 세로 100% 채우기, 비율 유지 */}
      <img 
        src="/assets/hyeni/character-main.png" 
        alt="Hyeni Character"
        style={{ 
          height: '100%',
          aspectRatio: '600 / 800',
          maxWidth: 'none'
        }}
        className="opacity-95 drop-shadow-2xl"
        draggable={false}
      />

      {/* 그라데이션 오버레이 */}
      <div className="absolute inset-0 bg-gradient-to-br from-pink-900/10 via-transparent to-purple-900/10 pointer-events-none -z-10" />
    </div>
  );
}

/**
 * 데코레이션 캐릭터 (우측 상단용)
 */
export function DecorationCharacter() {
  return (
    <div className="w-32 h-32 pointer-events-none">
      <img 
        src="/assets/hyeni/deco-sparkles.png" 
        alt="Decoration"
        className="w-full h-full object-contain opacity-90 drop-shadow-lg"
        draggable={false}
      />
    </div>
  );
}
