import styles from "./DataSources.module.css";
import provenanceJson from "@/lib/data/dataProvenance.json";
import { provenanceView, type DataProvenance } from "@/lib/data/dataProvenance";

const view = provenanceView(provenanceJson as DataProvenance);

export function DataSources() {
  return (
    <section id="sources" className={styles.section} aria-labelledby="sources-heading">
      <h2 id="sources-heading" className="h2">{view.heading}</h2>
      {view.paragraphs.map((paragraph) => (
        <p key={paragraph} className="body">{paragraph}</p>
      ))}
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <caption>{view.tableCaption}</caption>
          <thead>
            <tr>
              <th scope="col">출처</th>
              <th scope="col">연결된 자료</th>
              <th scope="col">자료에 기록된 수집일</th>
            </tr>
          </thead>
          <tbody>
            {view.rows.map((row) => (
              <tr key={row.id}>
                <th scope="row">{row.title}</th>
                <td className={styles.num}>{row.programs}</td>
                <td>{row.fetched}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="body">{view.fetchedNote}</p>
      <p className="small muted">{view.refNote}</p>
      <h3 className="h3">날짜를 구분해서 보세요</h3>
      <ul className="bullets">
        {view.dates.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <h3 className="h3">신청 서식은 따로 셉니다</h3>
      <p className="body">{view.forms}</p>
      <h3 className="h3">공식 페이지</h3>
      <p className="body">{view.linkNote}</p>
      <ul className={styles.links}>
        {view.links.map((link) => (
          <li key={link.href}>
            <a className={styles.link} href={link.href} target="_blank" rel="noopener noreferrer">
              {link.label}
              <small>{link.roleLabel}</small>
              <span className="sr-only"> 새 창</span>
            </a>
          </li>
        ))}
      </ul>
      <div className={styles.limit} role="note">
        {view.limits.map((line) => (
          <p key={line}>{line}</p>
        ))}
      </div>
    </section>
  );
}
