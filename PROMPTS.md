# Codex setup

- Client: Codex desktop app
- Model: `gpt-5.6-sol`
- Reasoning effort: `high`
- Approval policy: `never`
- Sandbox mode: `danger-full-access`
- Personality: `pragmatic`
- Collaboration mode: `Default`
- Subagents: not used

## User prompts

I am interviewing for a team lead position at saga legal which is a legal tech company making use of AI. I've added the pdf spec to this directory. I want you to first read the PDF and we'll complete this assignment together. But I want to be involved in every decision we make, so do not move forward without my approval.
Ok, let's forget about tier 2 & 3 and focus on core. I want this to be implemented using typescript. I know a few decisions that we should use: 1. If we are using a SQL db (we should use I think but debate with me) then we use SQLite 2. We should use an ORM, drizzle or prism would do, it's important that it is typescript compatible 3. It seems we'll have an async job processing pipeline, which indicates we should have a queue. For the initial version we can use the SQL database as a queue, and we can later consider using something else for queueing requests for async processing. 4. I think we can use express.js as the backend framework.
If you check the "technical decisions and trade-offs" section of the assignment it mentions vector db and asks why pgvector/chroma/faiss? I think before finalizing our architecture and decisions we must think about vector db. Let's start by asking, which process or API fills the vector database and who are the consumers? And what is it filled with?
Let's say we want to keep sqlite as its dead simple for an assignment and self contained docker image, what are our vector options?
If we decide to use postgres instead of sqlite, can you reevaluate what we can do about vector db? Although it's not as simple as having sqlite but still we can put postgres in our docker set up and the reviewers of the assignment can run that locally.
Ok let's use postgres. I want you to document our decisions and the architecture in a readme file in this repository. Make sure to follow the assignment's detailed expectations when building this readme. Do not build the actual application yet. Please flag any decisions we haven't made yet.
Some finalized decisions: 1. We use drizzle 2. We use pgvector
We use node-postgres.
I have no idea about chunking strategy, embedding model and generation model. Let's keep those as subject to change and start with sane defaults but first explain to me like I'm 5 years old, keep it very short.
Ok, anything left to decide?
1. We can use openai, but let's make it configurable to use local models as well, so it must be configurable. 2. We can use shared docker volume 3. We can search each document, the idea is to keep it simple on the API surface as this is an assignment 4. Keep API surface simple and small 5. Whatever would be easy for the reviewers to use, I want them to have least amount of friction running this 6. Default is good 7. Use the most starred libs on github/npm or whatever the industry preferred way is.
Let's talk about testing a little. I want to have some end-to-end tests for the main use cases. I want unit tests but they must be purely testing a single module. Unit tests must be easy to run, they must reside in a separate root folder (src vs test and the paths should match, for example src/api/endpoint.ts will have tests in test/api/endpoint.spec.ts) Unit tests must mock any dependency that the module being tested depends on. But do not be puristic, be pragmatic. Let's write these down in the readme as well and let's finalize our readme file before moving on to implementation.
Begin implementation using the plan and guidance of [README.md](README.md)
Ok, how can I see this in action? Walk me through so I can try it manually myself.
Ok I ingested the pdf file and asked the same question you mentioned. It says "The supplied context does not state which document formats the core API must support. It only shows endpoints and a few other snippets, but no supported formats are listed [1][2][3]." I think this is wrong, why did it fail to find that information, how can we debug?
Ok go ahead, also please add some unit or integration tests to make sure our pdf extraction logic is as good quality as we want it to be.
Can you describe the e2e tests we have? I want to know which scenarios we are testing
What input files do we have?
Ok, I've now added some input files to be used in e2e tests. Please update fixtures to use those. They are in @test/files/ folder. Make sure to first go over the files and create questions and expected answers based on the information in those files. These will be part of the fixture, so it needs to be somewhat deterministic.
Add an endpoint to list all sessions, it would be useful while testing this from the outside.
I want to ingest the json file in test files myself, what's the curl command?
Is there a way currently to continue chatting in a session? Like I post to the chat endpoint and provide a session ID to continue an existing session?
Let's now focus on tier-2 intermediate requirements. There are 4 of them. I want you to go over them and let's order them by easiness and value provided regarding the assignment. I don't want to implement all of them, I think we should just select one and do it. Which one would be the best candidate?
I don't understand the design decision, can you expand a bit?
Ok that makes sense, let's do the follow up context improvement.
Why do we have imports of .js files? If I remember correct, we can drop the extension. Can you check?
What do you mean introducing bundler/loader ?
Let's use esbuild and drop the extensions. Also make sure we have proper stack traces, I want to have the original typescript file references and line references if I get a stack trace.
Ok let's focus on README file, we need to address all the requirements from the original assignment pdf. It asks for certain information to be provided in the readme.
I approve
Let's remove/change wording to make the readme not sound like it is an assignment. I don't want to see things like "decided". No need for a history/gradual build up wording.
I want to connect to the postgres instance and inspect the vector db myself, I want to understand what we store there by querying it myself
Put all of these in a new readme file named DATABASE.md. So someone looking at it can connect to the db and execute these queries.
Now create a PROMPTS.md file and go through all the prompts I've sent you and put them in that file in separate lines. I want only my prompts, only user prompts and none of your output.
At the top of the prompts file please add my codex set up (which model was used etc.)
