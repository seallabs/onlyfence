// Simple typing effect for the hero CTA
document.addEventListener("DOMContentLoaded", () => {
    const textToType = "npm i -g @onlyfence/cli";
    const typingElement = document.getElementById("hero-typing");
    let i = 0;
    let isTyping = false;

    // Clear content initially
    typingElement.textContent = "";

    function typeWriter() {
        if (i < textToType.length) {
            typingElement.textContent += textToType.charAt(i);
            i++;
            setTimeout(typeWriter, 40); // typing speed
        } else {
            // Add a blinking cursor effect
            typingElement.innerHTML = textToType + '<span style="animation: blink 1s step-end infinite;">_</span>';
        }
    }

    // Initialize typing effect after a short delay
    setTimeout(() => {
        if (!isTyping) {
            isTyping = true;
            typeWriter();
        }
    }, 500);

    // Add blink CSS animation dynamically
    const style = document.createElement('style');
    style.innerHTML = `
        @keyframes blink {
            0%, 100% { opacity: 1; }
            50% { opacity: 0; }
        }
    `;
    document.head.appendChild(style);

    // Simple smooth scrolling for anchor links
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            if (this.getAttribute('href') !== "#") {
                e.preventDefault();
                const targetId = this.getAttribute('href');
                const targetElement = document.querySelector(targetId);
                if (targetElement) {
                    window.scrollTo({
                        top: targetElement.offsetTop - 80, // Offset for navbar
                        behavior: 'smooth'
                    });
                }
            }
        });
    });
});
