---
layout: default
---

{% for post in site.posts %}
<div class="post-card">
    {% if post.thumbnail %}
    <div class="post-thumbnail">
        <a href="{{ post.url | relative_url }}">
        <img src="{{ post.thumbnail | relative_url }}" alt="{{ post.title }}">
        </a>
    </div>
    {% endif %}
    
    <div class="post-content">
        <span class="category-tag">
        {% for category in post.categories %}
        <a href="{{ category | prepend: '/category/' | relative_url }}">
            {{ site.category_names[category] | default: category }}
        </a>
        {% endfor %}
        </span>
        <h2 class="index-post-title"><a href="{{ post.url | relative_url }}">{{ post.title }}</a></h2>
        <p class="post-meta">{{ post.date | date: "%B %d, %Y" }}</p>
        
        <p>{{ post.content | strip_html | truncate: 90 }}</p>
        
        <a href="{{ post.url | relative_url }}" class="read-more">Read More →</a>
    </div>
</div>
{% endfor %}