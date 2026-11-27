import type { SurveyPackId } from "../../shared/survey-online";
import { adultQuestions } from "./adult-questions";
import { classicQuestions } from "./classic-questions";
import type { Question } from "./survey";

export { QuestionDeck } from "./question-deck";

type QuestionPack = {
  name: string;
  questions: readonly Question[];
  scoring: "survey" | "editorial";
  questionCategories?: readonly string[];
};

export const questionPacks: Readonly<Record<SurveyPackId, QuestionPack>> = {
  classic: { name: "Классика", questions: classicQuestions, scoring: "survey" },
  adult: {
    name: "18+",
    questions: adultQuestions,
    scoring: "editorial",
    questionCategories: adultQuestions.map(({ category }) => category),
  },
};
