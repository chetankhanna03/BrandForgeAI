# BrandForge AI
### BrandDNA + BrandTwin: Intelligent Brand Compliance Across Platforms

## 1. Understanding of the Problem

Today, companies create content for multiple platforms such as Instagram, LinkedIn, and websites. However, maintaining the same brand identity across these platforms is difficult.

Brand guidelines are usually stored in lengthy documents containing rules about logos, colors, typography, tone, product information, and marketing claims.

Manually checking every piece of content against these guidelines takes time and can lead to mistakes. Incorrect product information, outdated claims, or inconsistent branding can affect a company's credibility.

Our goal is to build a system that understands a company's brand guidelines and checks marketing content before it is published.

Rather than simply identifying errors, the system will explain why the content violates a guideline, suggest corrections, and help maintain consistency across different platforms.

## 2. Users Affected by the Problem

**Marketing Teams:** They regularly create content for different platforms and need to ensure that it follows brand guidelines.

**Content Creators and Designers:** They often spend additional time checking designs, captions, and promotional content against brand requirements.

**Brand Managers:** They are responsible for maintaining brand consistency and reviewing content before publication.

**Agencies:** External agencies working with multiple brands need to follow different guidelines for each client.

**Compliance Teams:** They need to ensure that published content does not contain misleading information or unapproved claims.

## 3. Proposed Solution

We propose **BrandForge AI**, a platform that combines two main concepts: BrandDNA and BrandTwin.

### BrandDNA: Brand Knowledge Graph

When a company uploads its brand guidelines, our system extracts important information such as product specifications, approved claims, brand colors, terminology, and other rules.

This information is organized into a knowledge graph where related information is connected.

For example:

Brand → Product → Battery Range → 400 km

The knowledge graph allows the system to understand how different brand facts and rules relate to each other.

If a company changes an approved product specification, the system can identify saved marketing drafts that depend on the previous information and flag them for review.

### BrandTwin: Cross-Platform Brand Testing

BrandTwin allows users to test their marketing content across multiple platforms before publishing.

Initially, we will support Instagram, LinkedIn, and websites.

The system will check the content against the company's brand guidelines along with the relevant platform-specific requirements.

For example, the same advertisement might follow the company's brand rules but require different formatting or wording for Instagram and LinkedIn.

Users will be able to preview their content, identify potential violations, and make corrections before submitting it for approval.

### Brand Compliance Engine

Instead of relying entirely on an LLM to decide whether content is correct, we will convert supported brand guidelines into structured rules that can be checked programmatically.

For example, if a company's approved vehicle range is 400 km and an advertisement mentions 500 km, the system will identify the mismatch and display the approved information.

An LLM will help with understanding documents and extracting information, while our rule engine will handle checks that can be verified directly.

This makes the results more consistent and easier to explain.

## 4. Complete Product Workflow

**Step 1: Brand Onboarding**

The company uploads its brand guidelines and provides approved product information.

**Step 2: Knowledge Graph Creation**

The system extracts important brand information and organizes it into connected facts and rules. The brand manager can review and confirm the extracted information.

**Step 3: Content Upload**

A marketing employee uploads an advertisement or enters marketing copy.

**Step 4: Platform Selection**

The user selects the platforms where the content will be published, such as Instagram, LinkedIn, or a website.

**Step 5: Brand Compliance Testing**

The system compares the content with the approved brand information and applies relevant platform-specific rules.

**Step 6: Results and Suggestions**

The system highlights violations, explains the relevant rules, and suggests possible corrections.

**Step 7: Review and Approval**

The corrected content is submitted to an authorized reviewer, who can approve it or request further changes.

**Step 8: Continuous Brand Updates**

If approved brand information changes, the system identifies affected saved drafts and flags them for another review.

## 5. Main Features

1. **Automated Brand Guideline Extraction:** Extract important brand information from uploaded PDF documents.

2. **Brand Knowledge Graph:** Store relationships between brand guidelines, products, claims, and marketing content.

3. **Cross-Platform Testing:** Check content against brand rules and configured requirements for Instagram, LinkedIn, and websites.

4. **Rule-Based Compliance Checking:** Use programmatic checks for product facts, prohibited phrases, required disclaimers, and content limits.

5. **AI-Based Suggestions:** Explain detected problems and recommend possible improvements.

6. **Platform Previews:** Show how content would appear in different publishing contexts.

7. **Human Approval Workflow:** Allow reviewers to approve content or request revisions.

8. **Change Impact Detection:** Identify saved marketing drafts that may become outdated when approved company information changes.

## 6. Technology Stack

**Frontend**
- Next.js and React for building the web application.
- Tailwind CSS for designing the interface.
- React Flow for displaying the knowledge graph.

**Backend**
- Python and FastAPI for API development and content processing.
- PyMuPDF for extracting information from PDF documents.

**AI and Compliance**
- An LLM API for extracting structured information and understanding marketing claims.
- Python-based validation functions for checking executable brand rules.

**Database**
- SQLite for storing brand information, graph relationships, marketing drafts, and review history.

### Technical Approach

The main technical challenge is converting natural-language brand guidelines into information that can be checked reliably.

To address this, we will use an LLM to suggest structured facts and rules from uploaded documents. A reviewer can confirm these before they become part of the approved brand knowledge.

For checks involving exact specifications, prohibited words, or required phrases, our backend will use deterministic validation instead of depending entirely on AI responses.

The same approved information will be used for testing content across all supported platforms.

## 7. Responsibilities of Team Members

**Team Member 1: Backend and AI Development**

Responsible for:
- PDF processing and information extraction.
- Knowledge graph data structure.
- AI integration and compliance checking.
- Database and API development.
- Change impact detection.

**Team Member 2: Frontend and Platform Testing**

Responsible for:
- Designing and developing the frontend.
- Brand guideline upload interface.
- Knowledge graph visualization.
- Instagram, LinkedIn, and website previews.
- Compliance results and approval interface.
- Integration with backend APIs.

Both team members will work together on testing, debugging, documentation, and the final demonstration.

## 8. Development Plan Across Three Rounds

### Round 1: Planning and Architecture

In this round, we will focus on understanding the problem, defining the product workflow, finalizing the technologies, and identifying the features that can realistically be developed.

We will also prepare the system architecture and divide responsibilities between team members.

### Round 2: Core Development

We will focus on creating a working prototype.

Our priorities will be:
- Brand guideline extraction.
- Knowledge graph creation.
- Content upload and compliance checking.
- Three platform previews.
- Basic correction and review workflow.

We will also work on connecting the different components into a complete system.

### Round 3: Improvements and Final Product

We will improve the reliability and usability of the prototype.

Our three main improvement areas will be:

**1. Evidence-Based Compliance:** Improve the accuracy of checks and show which approved brand information supports each finding.

**2. Platform-Specific Testing:** Improve the testing experience by applying different configured rules to different publishing platforms.

**3. Knowledge Change Detection:** Improve the system's ability to identify marketing drafts affected by updates to brand information.

We will test these improvements using sample content with known errors and document the results.

## 9. Expected Impact

BrandForge AI aims to reduce the amount of manual effort required to check marketing content before publication.

It can help marketing teams identify incorrect claims, use approved product information, and maintain a more consistent brand identity across platforms.

Brand managers will be able to review content with clearer explanations rather than checking every guideline manually.

The knowledge graph will also help organizations keep track of which marketing drafts depend on specific product information or brand rules.

Overall, the platform aims to make brand governance faster, more organized, and easier to manage as content volume increases.

## 10. Future Scope

After the hackathon, we plan to explore the following improvements:

- Integrations with Canva, Figma, and other design tools.
- Support for additional platforms and content formats.
- More advanced logo, typography, and visual design checking.
- Multilingual brand compliance.
- Country-specific marketing and regulatory requirements.
- Automatic checking within content management systems.
- Support for multiple brands and organizations.
- More advanced approval workflows and version tracking.

In the long term, BrandForge AI could become a centralized platform for managing brand consistency across an organization's entire content creation process.

## 11. Team and Participant Details

**Team Name:** [Enter Team Name]

**Project Name:** BrandForge AI

**Team Leader:** [Full Name]

**Team Member 2:** [Full Name]

**College/Organization:** [College Name]

**Contact Email:** [Email Address]

**GitHub Repository:** [Link, if available]