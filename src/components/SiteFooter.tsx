import Link from "next/link";
import provenance from "@/lib/data/dataProvenance.json";
import { koCount } from "@/lib/data/dataProvenance";
import styles from "./SiteChrome.module.css";

export function SiteFooter() {
  return (
    <footer className={styles.footer}>
      <div className={styles.footerInner}>
        <div className={styles.footerTop}>
          <span>복지나침반</span>
          <ul className={styles.footerLinks}>
            <li><Link href="/about#sources">자료 출처 {koCount(provenance.basis.programRecords)}건</Link></li>
            <li><Link href="/search">서비스 검색</Link></li>
            <li><Link href="/about">출처·판정 기준</Link></li>
            <li><Link href="/about#privacy">개인정보</Link></li>
            <li><Link href="/forms">신청 서식</Link></li>
            <li><Link href="/data">데이터 현황</Link></li>
          </ul>
        </div>
        <details className={styles.footerDetails} open>
          <summary>서비스 안내·상담 연락처</summary>
          <p>정부24·복지로 자료를 활용한 민간 안내 서비스입니다. 최종 지원 여부와 신청 방법은 담당 기관에서 확인하세요.</p>
          <p>보건복지상담센터 <a href="tel:129">129</a> (평일 9시~18시, 긴급 24시간) · 정부민원안내 <a href="tel:110">110</a></p>
          <p>복지 판정과 신청서 작성은 이 기기에서 처리합니다. 신청서 입력 내용은 외부로 보내지 않습니다. 음성 입력을 사용하면 녹음한 음성을 OpenAI로 보냅니다.</p>
        </details>
      </div>
    </footer>
  );
}
