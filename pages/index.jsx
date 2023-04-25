import { HEADERS_STREAM } from "./api/converse-edge";
import { forwardRef, useEffect, useRef, useState } from "react";
import Head from "next/head";
import { useForm } from "react-hook-form";
import LogoOpenAI from "components/icons/LogoOpenAI";
import LogoUser from "components/icons/LogoUser";
import { inter } from "lib/fonts";
import { fetchEventSource } from "@microsoft/fetch-event-source";
import Link from "next/link";

class RetriableError extends Error {}
class FatalError extends Error {}

function Container({ children }) {
  return <div className="px-2 sm:px-4 md:mx-auto md:max-w-2xl md:px-0 xl:max-w-3xl">{children}</div>;
}

function MessageHuman({ message }) {
  return (
    <div className="group w-full border-b border-black/10 text-gray-800 dark:border-gray-900/50 dark:bg-gray-800 dark:text-gray-100">
      <Container>
        <div className="flex space-x-4 py-4 text-base md:space-x-6 md:py-6">
          <div className="relative flex h-8 w-8 items-center justify-center rounded-sm bg-gray-300 p-1 text-gray-600">
            <LogoUser className="h-6 w-6" />
          </div>
          <div className="min-h-[20px] whitespace-pre-wrap">{message}</div>
        </div>
      </Container>
    </div>
  );
}
function modifyStringWithCodeSnippet(str) {
  const codeSnippetStart = "```";
  const codeSnippetEnd = "```";
  let result = "";
  let startIndex = 0;

  while (startIndex < str.length) {
    const snippetStartIndex = str.indexOf(codeSnippetStart, startIndex);
    if (snippetStartIndex === -1) {
      result += str.substring(startIndex);
      break;
    }
    const snippetEndIndex = str.indexOf(codeSnippetEnd, snippetStartIndex + codeSnippetStart.length);
    if (snippetEndIndex === -1) {
      result += str.substring(startIndex);
      break;
    }
    result += str.substring(startIndex, snippetStartIndex);
    const code = str.substring(snippetStartIndex + codeSnippetStart.length, snippetEndIndex);
    result += `<pre><code>${code}</code></pre><button class="copy-button" onclick="copyToClipboard('${code}')">Copy</button>`;
    startIndex = snippetEndIndex + codeSnippetEnd.length;

    // Skip over the code snippet in the input string
    startIndex = str.indexOf(codeSnippetEnd, startIndex + codeSnippetEnd.length) + codeSnippetEnd.length;
  }

  return result;
}

const MessageBot = forwardRef(({ message, hidden }, ref) => {
  return (
    <div className={`${hidden ? "hidden" : "block"} group w-full border-b border-black/10 bg-gray-50 text-gray-800 dark:border-gray-900/50 dark:bg-[#444654] dark:text-gray-100`}>
      <Container>
        <div className="flex space-x-4 py-4 text-base md:space-x-6 md:py-6">
          <div className="">
            <LogoOpenAI className="" />
          </div>
          <div className="min-h-[20px] whitespace-pre-wrap">
            <div className="break-words">
              <p ref={ref} className={ref && !hidden ? "after:-mb-1 after:inline-block after:h-5 after:w-2 after:animate-blink after:bg-gray-600 after:content-[''] after:dark:bg-gray-400" : ""}>
                {message}
              </p>
            </div>
          </div>
        </div>
      </Container>
    </div>
  );
});
MessageBot.displayName = "MessageBot";

export default function Page() {
  const answerNode = useRef(null);
  const [conversation, setConversation] = useState({
    history: [],
  });
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState(null);
  const {
    register,
    handleSubmit,
    formState: { errors },
    setValue,
    setFocus,
  } = useForm();

  function onData(data) {
    if (!answerNode.current) {
      return;
    }
    try {
      let text = JSON.parse(data).choices[0].delta.content;
      if (text) {
        answerNode.current.innerText = answerNode.current.innerText + text;
      }
    } catch (err) {
      console.log(`Failed to parse data: ${data}`);
      if (data !== "[DONE]") {
        setError(`Failed to parse the response`);
      }
    }
  }

  function onClose() {
    setStreaming(false);
    setConversation((prev) => {
      return {
        ...prev,
        history: [
          ...prev.history,
          {
            speaker: "bot",
            text: answerNode.current?.innerText.replace(/<br>/g, "\n"),
          },
        ],
      };
    });
  }

  const onSubmit = (data) => {
    if (answerNode.current) {
      answerNode.current.innerText = "";
    }
    setStreaming(true);
    setValue("prompt", "");

    document.getElementsByTagName("textarea")[0].style.height = "auto";

    const newConversation = {
      history: [...conversation.history, { speaker: "human", text: data.prompt }],
    };

    setConversation(newConversation);

    const paramsObj = {
      conversation: JSON.stringify(newConversation),
      temperature: "0.7",
    };
    const ctrl = new AbortController();

    fetchEventSource("/api/converse-edge", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(paramsObj),
      openWhenHidden: true,
      signal: ctrl.signal,
      async onopen(response) {
        // answerValue.current = ""
        if (answerNode.current) {
          answerNode.current.innerText = "";
        }

        if (response.ok && response.headers.get("content-type")?.replace(/ /g, "") === HEADERS_STREAM["Content-Type"]) {
          // all good
          return;
        } else if (response.status >= 400 && response.status < 500 && response.status !== 429) {
          // client-side errors are usually non-retriable:
          throw new FatalError();
        } else {
          throw new RetriableError();
        }
      },
      onmessage(msg) {
        // if the server emits an error message, throw an exception
        // so it gets handled by the onerror callback below:
        if (msg.event === "FatalError") {
          throw new FatalError(msg.data);
        }
        try {
          onData(msg.data);
        } catch (error) {
          console.log("aborting");
          ctrl.abort();
          onClose();
        }
      },
      onclose() {
        // if the server closes the connection unexpectedly, retry:
        // throw new RetriableError()

        onClose();
      },
      onerror(err) {
        if (err instanceof FatalError) {
          console.log("onerror fatal", err);
          // rethrow to stop the operation
          // setAwaitingFirstToken(false)
          setStreaming(false);
          setError(`Something went wrong with the request`);
          // throw err
        } else {
          console.log("onerror other", err);
          // do nothing to automatically retry. You can also
          // return a specific retry interval here.
        }
      },
    });
  };

  useEffect(() => {
    if (typeof ResizeObserver === "undefined") {
      return () => {};
    }

    const observer = new ResizeObserver((entries) => {
      // TODO: debounce scroll?
      window.scroll({
        top: document.body.scrollHeight,
        behavior: "smooth",
      });
    });

    if (answerNode.current) {
      observer.observe(answerNode.current);
    }

    return () => {
      if (answerNode.current) {
        observer.unobserve(answerNode.current);
      }
    };
  }, [answerNode.current]);

  useEffect(() => {
    setFocus("prompt");
  }, [conversation.history]);

  return (
    <div className={inter.className}>
      <Head>
        <link rel="icon" href="/favicon.ico" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>CyberCell</title>
        <meta name="description" content="A basic clone of ChatGPT" />
        <meta name="og:title" content="CloneGPT" />
      
      </Head>
      <Link className="rounded-md bg-gray-800 py-2 px-4 font-medium text-white transition duration-300 ease-in-out hover:bg-blue-500" style={{ backgroundColor: "#1F2937" }} _target = "blank" href="https://chat.merlinwms.co.uk/">
        Goto Home
      </Link>

      <main className="relative flex w-full flex-col items-center overflow-hidden pb-24 text-sm md:pb-40">
        {conversation.history.length > 0 ? (
          conversation.history.map((x, i) => (x.speaker === "human" ? <MessageHuman key={i} message={x.text} /> : <MessageBot key={i} message={x.text} />))
        ) : (
          <div className="px-3 py-12 text-center dark:text-white">
            <h1 className="text-lg font-bold">Cyber Bot</h1>
            <p className="mt-4">Welcome to Cyber Bot</p>
          </div>
        )}

        <MessageBot ref={answerNode} message="" hidden={!streaming} />
      </main>
      <div className="fixed inset-x-0 bottom-0 border-t bg-gray-50 py-2 dark:border-white/20 dark:bg-gray-800 sm:py-4">
        <Container>
          <form onSubmit={handleSubmit(onSubmit)} className="relative flex flex-row items-center">
            <label htmlFor="chatbot-input" className="sr-only">
              Ask a question
            </label>
            <textarea
              id="chatbot-input"
              tabIndex={0}
              rows={1}
              placeholder=""
              onKeyUp={(e) => {
                const textarea = e.target;
                if (e.key === "Enter" && !e.shiftKey) {
                  const isEmpty = textarea.value.trim() === "";
                  if (isEmpty) {
                    textarea.value = "";
                  } else {
                    handleSubmit(onSubmit)();
                  }
                } else {
                  textarea.style.height = "auto"; // Reset the height to its default to allow it to shrink when deleting text
                  textarea.style.height = `${textarea.scrollHeight}px`; // Set the height to the scroll height so that it expands on new lines
                }
              }}
              className="max-h-52 w-full resize-none overflow-y-auto rounded-md border-0 bg-white p-2 text-gray-900 shadow-[0_0_10px_rgba(0,0,0,0.10)] ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-indigo-600 dark:bg-gray-700 dark:text-gray-200 dark:shadow-[0_0_15px_rgba(0,0,0,0.10)] dark:ring-gray-800 md:p-3 lg:pr-7"
              {...register("prompt", {
                required: true,
                disabled: streaming,
              })}
            />
            <button type="submit" className="ml-1 flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-500 hover:bg-gray-200 disabled:hover:bg-transparent dark:bg-gray-900 dark:hover:bg-black dark:hover:text-gray-400 dark:disabled:hover:bg-transparent lg:absolute lg:bottom-2.5 lg:right-2 lg:ml-0 lg:h-auto lg:w-auto lg:rounded-none lg:bg-transparent lg:p-1 lg:hover:bg-transparent">
              <svg stroke="currentColor" fill="currentColor" strokeWidth="0" viewBox="0 0 20 20" className="h-5 w-5 rotate-90 lg:h-4 lg:w-4" xmlns="http://www.w3.org/2000/svg">
                <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z"></path>
              </svg>
            </button>
          </form>
          <div className="mt-4">{error ? <p className="text-sm text-red-500">{error}</p> : <div className="space-x-2 text-center text-xs text-black/50 dark:text-white/50 md:px-4 md:pt-3 md:pb-6"></div>}</div>
        </Container>
      </div>
    </div>
  );
}
