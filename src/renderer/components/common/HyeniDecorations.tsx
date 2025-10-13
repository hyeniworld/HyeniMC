import { useState, useEffect } from 'react';

/**
 * 강혜니 일러스트 - 메인 캐릭터 (왼쪽 사이드바용)
 * 여러 캐릭터 이미지를 랜덤하게 페이드 전환
 */
export function HyeniDecorations() {
  const characterImages = [
    '/assets/hyeni/character-main.png',
    '/assets/hyeni/character-main1.png',
    '/assets/hyeni/character-main2.png',
    '/assets/hyeni/character-main3.png',
  ];

  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [fadeOut, setFadeOut] = useState(false);

  useEffect(() => {
    // 5초마다 이미지 전환
    const interval = setInterval(() => {
      // 페이드아웃 시작
      setFadeOut(true);
      
      // 500ms 후 이미지 변경 및 페이드인
      setTimeout(() => {
        setCurrentImageIndex((prevIndex) => {
          // 현재 인덱스를 제외한 랜덤 인덱스 선택
          const availableIndices = characterImages
            .map((_, idx) => idx)
            .filter(idx => idx !== prevIndex);
          const randomIndex = availableIndices[Math.floor(Math.random() * availableIndices.length)];
          return randomIndex;
        });
        setFadeOut(false);
      }, 500);
    }, 5000);

    return () => clearInterval(interval);
  }, [characterImages.length]);

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden flex items-end justify-center">
      {/* 메인 캐릭터 - 세로 100% 채우기, 비율 유지 */}
      <img 
        src={characterImages[currentImageIndex]}
        alt="Hyeni Character"
        style={{ 
          height: '100%',
          aspectRatio: '600 / 800',
          maxWidth: 'none'
        }}
        className={`drop-shadow-2xl transition-opacity duration-500 ${
          fadeOut ? 'opacity-0' : 'opacity-95'
        }`}
        draggable={false}
      />

      {/* 그라데이션 오버레이 */}
      <div className="absolute inset-0 bg-gradient-to-br from-pink-900/10 via-transparent to-purple-900/10 pointer-events-none -z-10" />
    </div>
  );
}

/**
 * 데코레이션 캐릭터 (우측 상단용)
 * 클릭 시 치지직 채널로 이동
 */
export function DecorationCharacter() {
  const handleClick = () => {
    // Electron 환경에서 외부 링크를 기본 브라우저로 열기
    if (window.electronAPI) {
      window.electronAPI.shell.openExternal('https://chzzk.naver.com/3081b4db8cb8b6c1de194b66a5b81a67');
    } else {
      // 일반 브라우저 환경
      window.open('https://chzzk.naver.com/3081b4db8cb8b6c1de194b66a5b81a67', '_blank');
    }
  };

  return (
    <div 
      className="w-32 h-32 cursor-pointer hover:scale-110 transition-transform duration-200"
      onClick={handleClick}
      title="강혜니 치지직 채널 방문하기"
    >
      <img 
        src="/assets/hyeni/deco-sparkles.png" 
        alt="Decoration"
        className="w-full h-full object-contain opacity-90 drop-shadow-lg hover:opacity-100"
        draggable={false}
      />
    </div>
  );
}
