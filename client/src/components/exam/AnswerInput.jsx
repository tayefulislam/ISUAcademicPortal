import MathText from '../MathText.jsx';

// Shared by the authenticated QuizAttempt page and the public/guest exam
// attempt page — question rendering/answer-capture is identical either way;
// only how the attempt/timer/identity are resolved differs between them.
export default function AnswerInput({ question, answer, onChange }) {
  switch (question.type) {
    case 'mcq':
    case 'true_false':
      return (
        <div className="space-y-2">
          {question.options.map((o) => (
            <label key={o._id} className="flex items-center gap-2 p-2.5 rounded-lg border border-slate-200 hover:bg-slate-50 cursor-pointer">
              <input type="radio" checked={answer.selectedOptionIds?.[0] === o._id} onChange={() => onChange({ selectedOptionIds: [o._id] })} />
              <MathText text={o.text} />
            </label>
          ))}
        </div>
      );
    case 'multi_select':
      return (
        <div className="space-y-2">
          {question.options.map((o) => {
            const checked = (answer.selectedOptionIds || []).includes(o._id);
            return (
              <label key={o._id} className="flex items-center gap-2 p-2.5 rounded-lg border border-slate-200 hover:bg-slate-50 cursor-pointer">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => {
                    const next = e.target.checked
                      ? [...(answer.selectedOptionIds || []), o._id]
                      : (answer.selectedOptionIds || []).filter((id) => id !== o._id);
                    onChange({ selectedOptionIds: next });
                  }}
                />
                <MathText text={o.text} />
              </label>
            );
          })}
        </div>
      );
    case 'numerical':
      return (
        <input
          type="number"
          step="any"
          value={answer.numericalAnswer ?? ''}
          onChange={(e) => onChange({ numericalAnswer: e.target.value === '' ? null : Number(e.target.value) })}
          className="w-full h-11 rounded-lg border border-slate-300 px-3"
          placeholder="Enter a number"
        />
      );
    case 'short_answer':
      return (
        <input
          value={answer.textAnswers?.[0] || ''}
          onChange={(e) => onChange({ textAnswers: [e.target.value] })}
          className="w-full h-11 rounded-lg border border-slate-300 px-3"
          placeholder="Your answer"
        />
      );
    case 'fill_blank': {
      const blanks = question.text.split('___').length - 1 || 1;
      const values = answer.textAnswers?.length ? answer.textAnswers : Array(blanks).fill('');
      return (
        <div className="space-y-2">
          {Array.from({ length: blanks }).map((_, i) => (
            <input
              key={i}
              value={values[i] || ''}
              onChange={(e) => {
                const next = values.slice();
                next[i] = e.target.value;
                onChange({ textAnswers: next });
              }}
              className="w-full h-10 rounded-lg border border-slate-300 px-3"
              placeholder={`Blank ${i + 1}`}
            />
          ))}
        </div>
      );
    }
    case 'long_answer':
      return (
        <textarea
          rows={8}
          value={answer.textAnswers?.[0] || ''}
          onChange={(e) => onChange({ textAnswers: [e.target.value] })}
          className="w-full rounded-lg border border-slate-300 p-3"
          placeholder="Write your answer..."
        />
      );
    case 'matching':
      return <MatchingInput question={question} answer={answer} onChange={onChange} />;
    default:
      return null;
  }
}

// The left-hand items are fixed by the question (matchingLeft) — the
// participant only fills in what each one matches to.
function MatchingInput({ question, answer, onChange }) {
  const leftItems = question.matchingLeft || [];
  const byLeft = new Map((answer.matchingAnswer || []).map((p) => [p.left, p.right]));

  const update = (left, right) => {
    const next = leftItems.map((l) => ({ left: l, right: l === left ? right : byLeft.get(l) || '' }));
    onChange({ matchingAnswer: next });
  };

  return (
    <div className="space-y-2">
      {leftItems.map((left) => (
        <div key={left} className="flex items-center gap-2">
          <span className="flex-1 text-sm text-slate-700 p-2.5 rounded-lg bg-slate-50 border border-slate-200">{left}</span>
          <span className="text-slate-400">→</span>
          <input
            value={byLeft.get(left) || ''}
            onChange={(e) => update(left, e.target.value)}
            placeholder="Your match"
            className="flex-1 h-10 rounded-lg border border-slate-300 px-3"
          />
        </div>
      ))}
    </div>
  );
}
