import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FormWriter } from "@/components/FormWriter";
import { PaperFormWriter } from "@/components/PaperFormWriter";
import { writingTemplate } from "@/lib/data/formWritingRegistry";
import paperSummary from "../../../../../public/forms/writing/v1/index.json";

// 빌드에 포함한 정적 색인만 읽는다. 배포 서버의 동적 public 파일 탐색에 기대지 않는다.
const paperIds = new Set((paperSummary as { formIds?: string[] }).formIds ?? []);

export async function generateMetadata({ params }: PageProps<"/forms/write/[id]">): Promise<Metadata> {
  const { id } = await params;
  const template = writingTemplate(id);
  if (!template && !paperIds.has(id)) return { title: "찾을 수 없는 페이지" };
  // 작성 화면은 입력 내용이 담기는 화면이라 검색엔진에 올리지 않는다.
  return { title: `${template ? template.title : "원본 양식"} 화면에서 작성하기`, robots: { index: false, follow: false } };
}

/**
 * 손으로 등록한 두 서식은 기존 단계별 작성기로, 그 밖의 검증된 변환본은
 * 원본 양식을 그대로 보며 채우는 범용 작성기로 보낸다.
 * 변환 자산과 manifest가 없는 서식은 작성기가 스스로 미지원으로 안내한다.
 */
export default async function FormWritePage({ params, searchParams }: PageProps<"/forms/write/[id]">) {
  const { id } = await params;
  const template = writingTemplate(id);
  if (!template && !paperIds.has(id)) notFound();
  const raw = (await searchParams).program;
  const program = typeof raw === "string" ? raw : undefined;
  if (template) return <FormWriter key={`${template.formId}:${program ?? ""}`} template={template} programId={program} />;
  return <PaperFormWriter key={`${id}:${program ?? ""}`} formId={id} programId={program} />;
}
