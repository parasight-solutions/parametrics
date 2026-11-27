import { useEffect, useRef, useState } from "react";

const ExpandableText = ({ text }) => {
  const [expanded, setExpanded] = useState(false);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const textRef = useRef(null);

  useEffect(() => {
    const element = textRef.current;

    if (!element) return;

    const checkOverflow = () => {
      if (!expanded) {
        setIsOverflowing(element.scrollHeight > element.clientHeight);
      }
    };

    checkOverflow();

    const observer = new ResizeObserver(checkOverflow);
    observer.observe(element);

    return () => observer.disconnect();
  }, [text, expanded]);

  return (
    <div className="relative px-1">
      <p
        ref={textRef}
        className={`whitespace-pre-line break-words ${expanded ? "" : "line-clamp-3"}`}
      >
        {text || "-"}
      </p>

      {(isOverflowing || expanded) && (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((prev) => !prev)}
          className={`cursor-pointer text-sm text-blue-600 hover:underline ${
            expanded ? "" : "absolute bottom-0 right-1 bg-white pl-2"
          }`}
        >
          {expanded ? "Show less" : "...more"}
        </button>
      )}
    </div>
  );
};

export default ExpandableText;
