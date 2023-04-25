import { Configuration, OpenAIApi } from "openai-edge"

const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY
})
const openai = new OpenAIApi(configuration)

export const HEADERS_STREAM = {
  "Access-Control-Allow-Origin": "*",
  "Content-Type": "text/event-stream;charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  "X-Accel-Buffering": "no"
}

function getMessages({ conversation }) {
  let messages = [{ role: "system", content: "You are a helpful assistant." }]
  conversation.history.forEach((speech, i) => {
    messages.push({
      role: speech.speaker === "human" ? "user" : "assistant",
      content: speech.text
    })
  })
  return messages
}

function validateConversation(conversation) {
  if (!conversation) {
    throw new Error("Invalid conversation")
  }
  if (!conversation.history) {
    throw new Error("Invalid conversation")
  }
}

function validateTemperature(temperature) {
  if (isNaN(temperature)) {
    throw new Error("Invalid temperature")
  }
  if (temperature < 0 || temperature > 1) {
    throw new Error("Invalid temperature")
  }
}

const handler = async req => {
  const body = await req.json()

  let conversation
  let temperature
  try {
    conversation = JSON.parse(body.conversation)
    temperature = parseFloat(body.temperature)
    validateConversation(conversation)
    validateTemperature(temperature)
  } catch (e) {
    return new Response(
      JSON.stringify({ message: e.message || "Invalid parameter" }),
      {
        status: 400,
        headers: {
          "content-type": "application/json"
        }
      }
    )
  }

  try {
    const completion = await openai.createChatCompletion({
      model: "gpt-3.5-turbo",
      messages: getMessages({ conversation }),
      max_tokens: 1024,
      temperature,
      stream: true
    })

    return new Response(completion.body, {
      headers: HEADERS_STREAM
    })
  } catch (error) {
    console.error(error)
    if (error.response) {
      console.error(error.response.status)
      console.error(error.response.data)
    } else {
      console.error(error.message)
    }
    return new Response(JSON.stringify(error), {
      status: 400,
      headers: {
        "content-type": "application/json"
      }
    })
  }
}

export const config = {
  runtime: "edge"
}

export default handler
