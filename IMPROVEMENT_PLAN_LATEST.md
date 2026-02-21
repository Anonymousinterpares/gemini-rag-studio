1. read improvement_plan.md and verify if all is already impleemnted -- Full AUDIT!

2. FEATURE EXPANSION:
    2.1. Build Case file funcitonality
        - applicaiton engine should be able to compose an extensive document, with paragraphs, chapters, sections, introduction, summary, analysis, hypothesis or any other sections relevant to given topic -- all of that based on the current Chat context -> app engine should NOT take into account any context which was part of internal calls, warning messages - ONLY what user can see himself in the UI
        - the purpose is to improve ability of LLM to compose very extensive reports which are consistent, without hallucination, duplication, redundancy on given topic.
        - for that functionality, it would be helpful if after initial analysis step (very brief) LLM would have a chance to ask user what exactly should be analysed for the case file -> this is to make it more robust in case there are many different aspects or topics within the chat
    2.2. Create story plot analysis and summary. Critical features:
        - applicaiton engine should be able to see chronology without mixups (know what part of analysed document e.g. a book, is earlier and which is later in the book) -- written chronology
        - app. should be able to analyse content to see if written chronology fully aligns with actual chronology, e.g. in a book, there can be parts (chapters, paragraphs, sections) which relate to the past compared with current chain of events -- engine & workflow needed to detect it
        - standard RAG searcjh would NOT suffice to detect full plot without missing any information -- anakysis/brainstorm on how to maximize accuracy without pushing whole book context to LLM
    2.3. rebuild/expand the applciation to enable it beeing an enterprise grade RAG system which would be able to handle tens, hundreds or even thousands of documents. Critical features:
        - robustness
        - ability to cope with even extremally large datasets
        - ability to provide links to documents and render preview on clicking on links provided as data sources for given claims (as currently!)
        - ability to store preprocessed data locally so that it would be ready on next app instance, even after full reboot
