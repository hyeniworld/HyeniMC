import axios, { AxiosInstance } from 'axios';
import http from 'http';
import https from 'https';

/**
 * HTTP Keep-Alive를 지원하는 axios 인스턴스
 * Modrinth 앱의 TCP Keep-Alive 방식을 참고하여 구현
 */
export class HttpClient {
  private static instance: AxiosInstance;

  static getInstance(): AxiosInstance {
    if (!HttpClient.instance) {
      // HTTP/HTTPS 에이전트 생성 (Keep-Alive 활성화)
      const httpAgent = new http.Agent({
        keepAlive: true,
        keepAliveMsecs: 10000, // 10초
        maxSockets: 50, // 최대 소켓 수
        maxFreeSockets: 10,
        timeout: 30000, // 30초 타임아웃
      });

      const httpsAgent = new https.Agent({
        keepAlive: true,
        keepAliveMsecs: 10000,
        maxSockets: 50,
        maxFreeSockets: 10,
        timeout: 30000,
      });

      HttpClient.instance = axios.create({
        httpAgent,
        httpsAgent,
        timeout: 30000,
        // 연결 재사용으로 성능 향상
        maxRedirects: 5,
      });
    }

    return HttpClient.instance;
  }

  /**
   * Keep-Alive 연결 정리
   */
  static destroy(): void {
    if (HttpClient.instance) {
      // 에이전트 정리
      const httpAgent = (HttpClient.instance.defaults.httpAgent as http.Agent);
      const httpsAgent = (HttpClient.instance.defaults.httpsAgent as https.Agent);
      
      if (httpAgent) {
        httpAgent.destroy();
      }
      if (httpsAgent) {
        httpsAgent.destroy();
      }
    }
  }
}
